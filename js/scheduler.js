// 팀원 시간표를 겹쳐서 공통으로 비는 시간을 찾는다.
(function () {
  const STEP = 30; // 분 단위 격자

  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  // 해당 요일 [t, t+STEP) 칸에 수업 중인 팀원 이름 목록
  function busyAt(members, day, t) {
    return members
      .filter((m) => m.slots.some((s) => s.day === day && toMin(s.start) < t + STEP && toMin(s.end) > t))
      .map((m) => m.name);
  }

  // 모든(또는 maxAbsent명까지 빠진) 팀원이 비어 있는 연속 구간
  function freeBlocks(members, {
    days = ["MON", "TUE", "WED", "THU", "FRI"], dayStart = "09:00", dayEnd = "21:00",
    minMinutes = 60, maxAbsent = 0,
  } = {}) {
    const ds = toMin(dayStart), de = toMin(dayEnd), out = [];
    for (const day of days) {
      const cells = [];
      for (let t = ds; t + STEP <= de; t += STEP) cells.push(busyAt(members, day, t));
      let runStart = null;
      for (let i = 0; i <= cells.length; i++) {
        const ok = i < cells.length && cells[i].length <= maxAbsent;
        if (ok && runStart === null) runStart = i;
        else if (!ok && runStart !== null) {
          const minutes = (i - runStart) * STEP;
          if (minutes >= minMinutes) {
            const absent = [...new Set(cells.slice(runStart, i).flat())].sort();
            out.push({
              day, start: toHHMM(ds + runStart * STEP), end: toHHMM(ds + i * STEP),
              minutes, available: members.length - absent.length, absent,
            });
          }
          runStart = null;
        }
      }
    }
    return out;
  }

  window.TP_SCHEDULER = { freeBlocks, busyAt, toMin, toHHMM, STEP };
})();
