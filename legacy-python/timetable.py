"""에브리타임 시간표 캡처에서 수업 블록 위치를 찾아 요일/시간으로 바꾼다 (OpenCV, 무료·오프라인).

과목명은 읽지 않는다. 공통 빈 시간 계산에는 '언제 바쁜지'만 있으면 충분하기 때문.
가정:
- 위쪽에 요일 헤더 행, 왼쪽에 시간 열이 있는 격자
- 가로 격자선 간격 = 1시간
- 첫 시간 행은 first_hour (에브리타임 기본값 9시)
"""

import warnings as _warnings
from typing import Literal

import cv2
import numpy as np
from pydantic import BaseModel, Field

Day = Literal["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
DAYS: list[Day] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
SNAP = 5  # 분 단위 반올림


class ClassSlot(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    day: Day
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    location: str | None = None


class Timetable(BaseModel):
    classes: list[ClassSlot]
    warnings: list[str] = []


class ExtractionError(Exception):
    pass


def _runs(mask_1d: np.ndarray) -> list[tuple[int, int]]:
    """True 구간들의 (시작, 끝) 목록."""
    padded = np.concatenate([[False], mask_1d, [False]])
    diff = np.diff(padded.astype(np.int8))
    return list(zip(np.where(diff == 1)[0], np.where(diff == -1)[0]))


def _centers(mask_1d: np.ndarray) -> list[int]:
    return [(a + b - 1) // 2 for a, b in _runs(mask_1d)]


def _find_grid(img: np.ndarray, sat: np.ndarray):
    """격자선(무채색, 배경보다 약간 어둡거나 밝은 선) 위치를 찾는다."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.int16)
    bg = int(np.median(gray))
    line_px = (np.abs(gray - bg) >= 6) & (np.abs(gray - bg) <= 90) & (sat < 30)
    h, w = gray.shape
    v_lines = _centers(line_px.mean(axis=0) > 0.35)
    h_lines = _centers(line_px.mean(axis=1) > 0.35)
    return v_lines, h_lines, bg


def _day_columns(v_lines: list[int]) -> list[tuple[int, int]]:
    if len(v_lines) < 3:
        raise ExtractionError("요일 칸을 찾지 못했습니다. 에브리타임 시간표 화면을 캡처해 주세요.")
    spans = [(a, b) for a, b in zip(v_lines, v_lines[1:]) if b - a > 20]
    width = float(np.median([b - a for a, b in spans]))
    # 시간 열처럼 좁은 칸은 제외
    return [(a, b) for a, b in spans if b - a > width * 0.7]


def _hour_rows(h_lines: list[int]) -> tuple[int, float]:
    """(첫 시간 행의 위쪽 y, 1시간 높이 px)."""
    if len(h_lines) < 3:
        raise ExtractionError("시간 줄을 찾지 못했습니다. 시간표 전체가 보이게 캡처해 주세요.")
    gaps = np.diff(h_lines)
    hour = float(np.median(gaps[gaps > 20]))
    # 다음 줄과 간격이 1시간인 첫 가로선 = 첫 시간 행 위쪽 (그 위는 요일 헤더)
    for y, g in zip(h_lines, gaps):
        if abs(g - hour) < hour * 0.15:
            return y, hour
    return h_lines[0], hour


def _hue_dist(a: float, b: float) -> float:
    d = abs(a - b)
    return min(d, 180 - d)


def _split_by_color(hue_rows: np.ndarray, y0: int, min_len: int) -> list[tuple[int, int]]:
    """세로로 붙은 서로 다른 색 블록을 나눈다.
    글자 가장자리 잡음을 피하려고 경계 위/아래 min_len 행씩의 대표 색을 비교한다."""
    n, segs, start = len(hue_rows), [], 0
    i = min_len
    while i <= n - min_len:
        with _warnings.catch_warnings():
            _warnings.simplefilter("ignore", RuntimeWarning)
            above = np.nanmedian(hue_rows[i - min_len:i])
            below = np.nanmedian(hue_rows[i:i + min_len])
        if not (np.isnan(above) or np.isnan(below)) and _hue_dist(above, below) > 10 \
                and _hue_dist(hue_rows[i - 1], hue_rows[i]) > 6:
            segs.append((y0 + start, y0 + i))
            start = i
            i += min_len
        else:
            i += 1
    segs.append((y0 + start, y0 + n))
    return segs


def _fmt(minutes: float) -> str:
    m = int(round(minutes / SNAP) * SNAP)
    return f"{m // 60:02d}:{m % 60:02d}"


def extract_timetable(image_bytes: bytes, first_hour: int = 9) -> Timetable:
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ExtractionError("이미지를 열 수 없습니다. JPG나 PNG 파일인지 확인해 주세요.")
    if max(img.shape[:2]) > 2400:  # 너무 큰 이미지는 축소
        s = 2400 / max(img.shape[:2])
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[..., 0].astype(np.float32), hsv[..., 1], hsv[..., 2]
    v_lines, h_lines, _ = _find_grid(img, sat)
    columns = _day_columns(v_lines)
    grid_top, hour_px = _hour_rows(h_lines)
    img_h = img.shape[0]

    colored = (sat > 50) & (val > 70)
    classes: list[ClassSlot] = []
    warnings: list[str] = []
    for ci, (x0, x1) in enumerate(columns[:7]):
        # 칸 가운데 60%만 보고, 행마다 색칠 비율로 블록 구간을 찾는다 (글자 때문에 생기는 구멍 무시)
        m = (x1 - x0) // 5
        band = colored[:, x0 + m:x1 - m]
        filled = band.mean(axis=1) > 0.15  # 굵은 흰 글자 줄도 블록으로 인정
        filled[:grid_top] = False
        band_hue = np.where(band, hue[:, x0 + m:x1 - m], np.nan)
        with _warnings.catch_warnings():  # 빈 행의 'All-NaN slice' 경고 숨김
            _warnings.simplefilter("ignore", RuntimeWarning)
            row_hue = np.nanmedian(band_hue, axis=1)
        for a, b in _runs(filled):
            for ya, yb in _split_by_color(row_hue[a:b], a, max(4, int(hour_px * 0.15))):
                if yb - ya < hour_px * 0.25:  # 15분 미만은 잡음
                    continue
                start = first_hour * 60 + (ya - grid_top) / hour_px * 60
                end = first_hour * 60 + (yb - grid_top) / hour_px * 60
                classes.append(ClassSlot(
                    name=f"수업 {len(classes) + 1}", day=DAYS[ci], start=_fmt(start), end=_fmt(end)))
                if yb >= img_h - 3:
                    warnings.append(f"{_fmt(start)}에 시작하는 {'월화수목금토일'[ci]}요일 수업이 이미지 아래에서 잘려 "
                                    f"끝나는 시각이 정확하지 않을 수 있습니다.")

    if not classes:
        raise ExtractionError("수업 블록을 찾지 못했습니다. 에브리타임 시간표 캡처인지 확인해 주세요.")
    classes.sort(key=lambda c: (DAYS.index(c.day), c.start))
    for i, c in enumerate(classes, 1):
        c.name = f"수업 {i}"
    return Timetable(classes=classes, warnings=warnings)
