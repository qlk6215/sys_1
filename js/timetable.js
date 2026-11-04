// 에브리타임 시간표 캡처에서 수업 블록 위치를 찾아 요일/시간으로 바꾼다. 브라우저 안에서만 처리(서버 전송 없음).
//
// 과목명은 읽지 않는다. 공통 빈 시간 계산에는 '언제 바쁜지'만 있으면 충분하기 때문.
// 가정:
// - 위쪽에 요일 헤더 행, 왼쪽에 시간 열이 있는 격자
// - 가로 격자선 간격 = 1시간
// - 첫 시간 행은 firstHour (에브리타임 기본값 9시)
(function () {
  const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const DAY_KO = "월화수목금토일";
  const SNAP = 5;        // 분 단위 반올림
  const MAX_SIDE = 2400; // 큰 이미지는 축소해서 처리

  class ExtractionError extends Error {}

  const median = (arr) => {
    if (!arr.length) return NaN;
    const s = Float64Array.from(arr).sort();
    const k = s.length >> 1;
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  const nanMedian = (arr) => median(arr.filter((v) => !Number.isNaN(v)));

  // true 구간들의 [시작, 끝) 목록
  function runs(mask) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= mask.length; i++) {
      const on = i < mask.length && mask[i];
      if (on && start < 0) start = i;
      else if (!on && start >= 0) { out.push([start, i]); start = -1; }
    }
    return out;
  }
  const centers = (mask) => runs(mask).map(([a, b]) => Math.floor((a + b - 1) / 2));

  const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 180 - d); };

  // OpenCV와 같은 스케일의 HSV(H 0~180, S/V 0~255)와 흑백값
  function toChannels(rgba, n) {
    const hue = new Float32Array(n), sat = new Uint8Array(n), val = new Uint8Array(n), gray = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), diff = max - min;
      val[i] = max;
      sat[i] = max ? Math.round((diff * 255) / max) : 0;
      let h = 0;
      if (diff) {
        if (max === r) h = (60 * (g - b)) / diff;
        else if (max === g) h = 120 + (60 * (b - r)) / diff;
        else h = 240 + (60 * (r - g)) / diff;
        if (h < 0) h += 360;
      }
      hue[i] = h / 2;
      gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return { hue, sat, val, gray };
  }

  // 격자선(무채색, 배경보다 약간 어둡거나 밝은 선) 위치
  function findGrid(gray, sat, w, h) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let bg = 0;
    for (let acc = 0, half = gray.length / 2; bg < 256; bg++) { acc += hist[bg]; if (acc >= half) break; }

    const colCount = new Uint32Array(w), rowCount = new Uint32Array(h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, d = Math.abs(gray[i] - bg);
        if (d >= 6 && d <= 90 && sat[i] < 30) { colCount[x]++; rowCount[y]++; }
      }
    }
    return {
      vLines: centers(Array.from(colCount, (c) => c / h > 0.35)),
      hLines: centers(Array.from(rowCount, (c) => c / w > 0.35)),
    };
  }

  function dayColumns(vLines) {
    if (vLines.length < 3) throw new ExtractionError("요일 칸을 찾지 못했습니다. 에브리타임 시간표 화면을 캡처해 주세요.");
    const spans = [];
    for (let i = 1; i < vLines.length; i++) if (vLines[i] - vLines[i - 1] > 20) spans.push([vLines[i - 1], vLines[i]]);
    const width = median(spans.map(([a, b]) => b - a));
    return spans.filter(([a, b]) => b - a > width * 0.7); // 시간 열처럼 좁은 칸은 제외
  }

  // [첫 시간 행의 위쪽 y, 1시간 높이 px]
  function hourRows(hLines) {
    if (hLines.length < 3) throw new ExtractionError("시간 줄을 찾지 못했습니다. 시간표 전체가 보이게 캡처해 주세요.");
    const gaps = hLines.slice(1).map((y, i) => y - hLines[i]);
    const hour = median(gaps.filter((g) => g > 20));
    // 다음 줄과 간격이 1시간인 첫 가로선 = 첫 시간 행 위쪽 (그 위는 요일 헤더)
    for (let i = 0; i < gaps.length; i++) if (Math.abs(gaps[i] - hour) < hour * 0.15) return [hLines[i], hour];
    return [hLines[0], hour];
  }

  // 세로로 붙은 서로 다른 색 블록을 나눈다.
  // 글자 가장자리 잡음을 피하려고 경계 위/아래 minLen 행씩의 대표 색을 비교한다.
  function splitByColor(hueRows, y0, minLen) {
    const n = hueRows.length, segs = [];
    let start = 0, i = minLen;
    while (i <= n - minLen) {
      const above = nanMedian(hueRows.slice(i - minLen, i));
      const below = nanMedian(hueRows.slice(i, i + minLen));
      if (!Number.isNaN(above) && !Number.isNaN(below) && hueDist(above, below) > 10
          && hueDist(hueRows[i - 1], hueRows[i]) > 6) {
        segs.push([y0 + start, y0 + i]);
        start = i;
        i += minLen;
      } else {
        i += 1;
      }
    }
    segs.push([y0 + start, y0 + n]);
    return segs;
  }

  const fmt = (minutes) => {
    const m = Math.round(minutes / SNAP) * SNAP;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  // 픽셀 데이터 → { classes: [{name, day, start, end, location}], warnings: [] }
  function analyze(rgba, w, h, firstHour = 9) {
    const { hue, sat, val, gray } = toChannels(rgba, w * h);
    const { vLines, hLines } = findGrid(gray, sat, w, h);
    const columns = dayColumns(vLines);
    const [gridTop, hourPx] = hourRows(hLines);

    const classes = [], warnings = [];
    columns.slice(0, 7).forEach(([x0, x1], ci) => {
      // 칸 가운데 60%만 보고, 행마다 색칠 비율로 블록 구간을 찾는다 (글자 때문에 생기는 구멍 무시)
      const m = Math.floor((x1 - x0) / 5), bx0 = x0 + m, bx1 = x1 - m, bw = bx1 - bx0;
      const filled = new Array(h).fill(false), rowHue = new Float32Array(h);
      for (let y = 0; y < h; y++) {
        const hues = [];
        for (let x = bx0; x < bx1; x++) {
          const i = y * w + x;
          if (sat[i] > 50 && val[i] > 70) hues.push(hue[i]);
        }
        filled[y] = y >= gridTop && hues.length / bw > 0.15; // 굵은 흰 글자 줄도 블록으로 인정
        rowHue[y] = median(hues);
      }
      for (const [a, b] of runs(filled)) {
        for (const [ya, yb] of splitByColor(Array.from(rowHue.subarray(a, b)), a, Math.max(4, Math.floor(hourPx * 0.15)))) {
          if (yb - ya < hourPx * 0.25) continue; // 15분 미만은 잡음
          const start = firstHour * 60 + ((ya - gridTop) / hourPx) * 60;
          const end = firstHour * 60 + ((yb - gridTop) / hourPx) * 60;
          classes.push({ name: "", day: DAYS[ci], start: fmt(start), end: fmt(end), location: null });
          if (yb >= h - 3) {
            warnings.push(`${fmt(start)}에 시작하는 ${DAY_KO[ci]}요일 수업이 이미지 아래에서 잘려 끝나는 시각이 정확하지 않을 수 있습니다.`);
          }
        }
      }
    });

    if (!classes.length) throw new ExtractionError("수업 블록을 찾지 못했습니다. 에브리타임 시간표 캡처인지 확인해 주세요.");
    classes.sort((p, q) => DAYS.indexOf(p.day) - DAYS.indexOf(q.day) || p.start.localeCompare(q.start));
    classes.forEach((c, i) => { c.name = `수업 ${i + 1}`; });
    return { classes, warnings };
  }

  // File/Blob → 결과
  async function extractTimetable(file, firstHour = 9) {
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch { throw new ExtractionError("이미지를 열 수 없습니다. JPG나 PNG 파일인지 확인해 주세요."); }
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    return analyze(ctx.getImageData(0, 0, w, h).data, w, h, firstHour);
  }

  window.TP_TIMETABLE = { extractTimetable, analyze, ExtractionError };
})();
