"""팀원 시간표를 겹쳐서 공통으로 비는 시간을 찾는다."""

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
STEP = 30  # 분 단위 격자


def to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def busy_grid(members: list[dict], day_start: int, day_end: int) -> dict[str, list[list[str]]]:
    """요일별 30분 칸마다 수업 중인 팀원 이름 목록."""
    n = (day_end - day_start) // STEP
    grid = {d: [[] for _ in range(n)] for d in DAYS}
    for m in members:
        for s in m["slots"]:
            a, b = to_min(s["start"]), to_min(s["end"])
            for i in range(n):
                cell_start = day_start + i * STEP
                if a < cell_start + STEP and b > cell_start:
                    grid[s["day"]][i].append(m["name"])
    return grid


def free_blocks(members: list[dict], *, days=("MON", "TUE", "WED", "THU", "FRI"),
                day_start="09:00", day_end="21:00", min_minutes=60,
                max_absent=0) -> list[dict]:
    """모든(또는 max_absent명까지 빠진) 팀원이 비어 있는 연속 구간."""
    ds, de = to_min(day_start), to_min(day_end)
    grid = busy_grid(members, ds, de)
    total = len(members)
    out = []
    for d in days:
        run_start = None
        cells = grid[d] + [None]  # 마지막 구간 닫기용 sentinel
        for i, busy in enumerate(cells):
            ok = busy is not None and len(busy) <= max_absent
            if ok and run_start is None:
                run_start = i
            elif not ok and run_start is not None:
                length = (i - run_start) * STEP
                if length >= min_minutes:
                    absent = sorted({n for c in grid[d][run_start:i] for n in c})
                    out.append({
                        "day": d,
                        "start": to_hhmm(ds + run_start * STEP),
                        "end": to_hhmm(ds + i * STEP),
                        "minutes": length,
                        "available": total - len(absent),
                        "absent": absent,
                    })
                run_start = None
    return out
