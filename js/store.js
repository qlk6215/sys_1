// 이 브라우저에 저장하는 내 팀 목록 (기기·브라우저마다 따로 저장됨)
//  - tp.memberships: { CODE: { id, token, name, teamName } }  참여한 팀 (토큰이 있어야 내 시간표 수정 가능)
//  - tp.visited:     { CODE: { name, at } }                    한 번이라도 열어 본 팀
(function () {
  const read = (key) => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
  const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };

  window.TP_STORE = {
    memberships: () => read("tp.memberships"),
    getMembership: (code) => read("tp.memberships")[code],
    setMembership(code, m) { const a = read("tp.memberships"); a[code] = m; write("tp.memberships", a); },
    clearMembership(code) { const a = read("tp.memberships"); delete a[code]; write("tp.memberships", a); },

    rememberTeam(code, name) { const v = read("tp.visited"); v[code] = { name, at: Date.now() }; write("tp.visited", v); },
    forgetTeam(code) { const v = read("tp.visited"); delete v[code]; write("tp.visited", v); },

    // 참여한 팀 + 열어 본 팀, 최근에 연 순서
    teams() {
      const v = read("tp.visited"), m = read("tp.memberships");
      const codes = new Set([...Object.keys(v), ...Object.keys(m)]);
      return [...codes]
        .map((code) => ({ code, name: v[code]?.name || m[code]?.teamName || "", at: v[code]?.at || 0, me: m[code]?.name || null }))
        .sort((a, b) => b.at - a.at);
    },
  };
})();
