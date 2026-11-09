// Supabase RPC 호출 (supabase/schema.sql 의 함수들)
(function () {
  const cfg = window.TP_CONFIG || {};

  async function rpc(fn, args) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_KEY) {
      throw new Error("js/config.js 에 Supabase URL과 키를 넣어 주세요.");
    }
    const headers = { "Content-Type": "application/json", apikey: cfg.SUPABASE_KEY };
    // 예전 형식(JWT) anon 키만 Authorization 헤더에도 넣는다
    if (cfg.SUPABASE_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.SUPABASE_KEY}`;

    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
        method: "POST", headers, body: JSON.stringify(args),
      });
    } catch {
      throw new Error("서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.");
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; }
    catch { throw new Error(`서버 응답을 읽지 못했습니다 (${res.status}). 잠시 뒤 다시 시도해 주세요.`); } // 서버가 멈췄을 때 오는 HTML 오류 페이지
    if (!res.ok) throw new Error(body?.message || `오류 (${res.status})`);
    return body;
  }

  window.TP_API = {
    createTeam: (name) => rpc("create_team", { p_name: name }),
    getTeam: (code) => rpc("get_team", { p_code: code }),
    joinTeam: (code, name) => rpc("join_team", { p_code: code, p_name: name }),
    saveSlots: (memberId, token, slots) => rpc("save_slots", { p_member_id: memberId, p_token: token, p_slots: slots }),
    leaveTeam: (memberId, token) => rpc("leave_team", { p_member_id: memberId, p_token: token }),
    proposeOption: (memberId, token, date, start, end) =>
      rpc("propose_option", { p_member_id: memberId, p_token: token, p_date: date, p_start: start, p_end: end }),
    voteOption: (memberId, token, optionId, vote) =>
      rpc("vote_option", { p_member_id: memberId, p_token: token, p_option_id: optionId, p_vote: vote }),
    confirmOption: (memberId, token, optionId) =>
      rpc("confirm_option", { p_member_id: memberId, p_token: token, p_option_id: optionId }),
    deleteOption: (memberId, token, optionId) =>
      rpc("delete_option", { p_member_id: memberId, p_token: token, p_option_id: optionId }),
  };
})();
