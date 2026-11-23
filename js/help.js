// 도움말: 화면 오른쪽 아래 ? 버튼과, 누르면 열리는 사용법 화면. 홈과 팀 페이지에서 같이 쓴다.
// 내용은 전부 고정 문구라 사용자 입력이 섞이지 않는다.
(function () {
  const HTML = `
    <div class="help-head">
      <h2>도움말</h2>
      <button type="button" class="ghost" data-help-close aria-label="도움말 닫기">닫기</button>
    </div>

    <h3>처음이라면 이 순서로</h3>
    <ol>
      <li><b>팀 만들기 또는 들어가기</b> 홈에서 팀 이름을 넣어 만들거나, 받은 초대 링크·코드로 들어갑니다.</li>
      <li><b>참여하기</b> 팀 화면 위쪽에 이름을 넣고 [참여]를 누릅니다. 가입은 없습니다.</li>
      <li><b>시간표 넣기</b> 업로드 탭에 에브리타임 시간표 캡처를 올립니다. 틀린 곳은 편집 탭에서 고치고 <b>[저장]</b>을 누릅니다.</li>
      <li><b>팀원 초대</b> 위쪽 [초대 링크 공유]로 단톡방에 링크를 보냅니다.</li>
      <li><b>시간 고르기</b> 모임 탭의 '모일 수 있는 시간'에서 마음에 드는 시간의 [후보로]를 누릅니다.</li>
      <li><b>투표하고 확정</b> 팀원들이 가능·불가를 누르고, 정해지면 [이 시간으로 확정]을 누릅니다. 확정한 모임은 [캘린더에 추가]로 넣습니다.</li>
    </ol>

    <h3>아래 탭은 이런 화면이에요</h3>
    <dl>
      <dt>팀</dt><dd>팀원 일정을 겹쳐 본 주간 표. 초록은 모두 가능, 색이 진할수록 일정 있는 사람이 많습니다. 칸을 누르면 누가 일정이 있는지 나옵니다.</dd>
      <dt>모임</dt><dd>모두 모일 수 있는 시간 목록과 투표. 회의 길이, 빠져도 되는 인원, 수업 전후 여유, 주말 포함을 고를 수 있습니다.</dd>
      <dt>업로드</dt><dd>에브리타임 시간표 사진을 올려 수업을 자동으로 넣습니다.</dd>
      <dt>편집</dt><dd>매주 반복되는 수업과 알바·동아리 같은 개인 일정을 직접 넣고 고칩니다.</dd>
      <dt>월별</dt><dd>시험·병원처럼 그날만 있는 일정을 달력에서 넣습니다. 날짜를 누르면 그날 일정이 나옵니다.</dd>
    </dl>

    <h3>자주 묻는 것</h3>
    <dl>
      <dt>고쳤는데 반영이 안 돼요</dt><dd>내 시간표는 [저장]을 눌러야 팀에 반영됩니다.</dd>
      <dt>시간표 사진이 잘 안 읽혀요</dt><dd>시간표 전체가 보이게 캡처하고, 첫 줄이 9시가 아니면 업로드 탭에서 '시간표 첫 줄'을 바꿔 주세요. 틀린 과목명과 시간은 편집 탭 목록에서 바로 고칠 수 있습니다.</dd>
      <dt>휴대폰과 PC에서 같이 쓰고 싶어요</dt><dd>참여한 기기의 내 시간표 화면에서 [다른 기기에서 열기]를 눌러 나오는 QR이나 링크를 다른 기기에서 여세요.</dd>
      <dt>사진은 어디에 저장되나요</dt><dd>저장되지 않습니다. 사진은 이 브라우저 안에서만 읽고, 인식한 일정만 저장합니다.</dd>
      <dt>예시 팀은 뭔가요</dt><dd>둘러보는 용도입니다. 고쳐도 내 화면에서만 바뀌고 저장되지 않습니다.</dd>
    </dl>`;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "help-fab";
  btn.setAttribute("aria-label", "도움말 열기");
  btn.textContent = "?";

  const dlg = document.createElement("dialog");
  dlg.className = "help";
  dlg.innerHTML = HTML;

  const open = () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); };
  const close = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); };
  btn.addEventListener("click", open);
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-help-close]")) close(); }); // 바깥을 누르거나 닫기

  document.body.append(btn, dlg);
  window.TP_HELP = { open, close };
})();
