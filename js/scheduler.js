// 팀원 일정을 겹쳐서 공통으로 비는 시간을 찾는다.
//
// 일정(slot): { name, day: "MON".., start: "HH:MM", end: "HH:MM", kind: "class"|"personal", date: "YYYY-MM-DD"|null }
//  - date 가 없으면 매주 그 요일에 반복, 있으면 그날만 적용
(function () {
  const STEP = 30;     // 팀 격자 칸 크기(분)
  const FINE = 5;      // 빈 시간 계산 해상도(분)
  const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  // ---- 날짜 (브라우저 현지 시간 = 한국 기준으로 사용) ----
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const dayOf = (s) => DAYS[(parseYmd(s).getDay() + 6) % 7];
  const today = () => ymd(new Date());

  // offset 주 뒤의 월~일 날짜 목록 [{ day: "MON", date: "2026-11-02" }, ...]
  function weekDates(offset = 0) {
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
    return DAYS.map((day, i) => ({ day, date: ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)) }));
  }

  // 특정 날짜(요일)에 적용되는 일정
  const slotsOn = (member, day, date) => member.slots.filter((s) => (s.date ? s.date === date : s.day === day));

  // 해당 날짜 [t, t+len) 에 일정이 있는 팀원 이름. buffer 분만큼 일정 앞뒤를 넓혀서 본다(이동 시간)
  function busyAt(members, day, t, { date = null, len = STEP, buffer = 0 } = {}) {
    return members
      .filter((m) => slotsOn(m, day, date).some((s) => toMin(s.start) - buffer < t + len && toMin(s.end) + buffer > t))
      .map((m) => m.name);
  }

  // 모든(또는 maxAbsent명까지 빠진) 팀원이 비어 있는 연속 구간
  // dates: weekDates() 결과 중 볼 날짜들
  function freeBlocks(members, {
    dates = weekDates(0).slice(0, 5), dayStart = "09:00", dayEnd = "21:00",
    minMinutes = 60, maxAbsent = 0, buffer = 0,
  } = {}) {
    const ds = toMin(dayStart), de = toMin(dayEnd), out = [];
    for (const { day, date } of dates) {
      const cells = [];
      for (let t = ds; t + FINE <= de; t += FINE) cells.push(busyAt(members, day, t, { date, len: FINE, buffer }));
      let runStart = null;
      for (let i = 0; i <= cells.length; i++) {
        const ok = i < cells.length && cells[i].length <= maxAbsent;
        if (ok && runStart === null) runStart = i;
        else if (!ok && runStart !== null) {
          const minutes = (i - runStart) * FINE;
          if (minutes >= minMinutes) {
            const absent = [...new Set(cells.slice(runStart, i).flat())].sort();
            out.push({
              day, date, start: toHHMM(ds + runStart * FINE), end: toHHMM(ds + i * FINE),
              minutes, available: members.length - absent.length, absent,
            });
          }
          runStart = null;
        }
      }
    }
    return out;
  }

  window.TP_SCHEDULER = { freeBlocks, busyAt, slotsOn, weekDates, dayOf, today, ymd, parseYmd, toMin, toHHMM, STEP, DAYS };
})();
