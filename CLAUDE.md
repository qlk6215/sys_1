# CLAUDE.md

팀플 캘린더: 팀원 시간표를 모아 공통 빈 시간을 찾고, 투표로 모임을 확정하는 웹 서비스. 충북대 학생 대상.
제품 목표와 범위는 [PRD.md](PRD.md), 기능별 요구사항(FR/NFR ID)은 「팀플 캘린더 요구사항 명세서」를 본다.

- 배포: https://teamplay-calendar.vercel.app (GitHub `qlk6215/sys_1`의 `main` push → Vercel 자동 배포, 약 20초)
- DB: Supabase 프로젝트 `uysonzjawmmmglbaulur`

## 구조

빌드 없는 정적 사이트(HTML + 바닐라 JS + CSS) + Supabase. 서버 코드는 없다.

| 경로 | 역할 |
| --- | --- |
| `index.html` | 홈: 팀 만들기, 코드로 이동, '내 팀' 목록 |
| `team.html` | 팀 페이지 전부(겹쳐 보기, 빈 시간, 투표, 내 시간표 편집). 페이지 스크립트가 파일 안에 있음 |
| `js/config.js` | Supabase URL과 publishable 키 |
| `js/api.js` | `TP_API` — Supabase RPC 호출 래퍼 (`fetch` → `/rest/v1/rpc/<fn>`) |
| `js/store.js` | `TP_STORE` — localStorage의 참여 정보(`tp.memberships`)와 열어 본 팀(`tp.visited`) |
| `js/scheduler.js` | `TP_SCHEDULER` — 주 날짜 계산, 날짜별 일정 적용, 공통 빈 시간(5분 단위, 이동 여유) |
| `js/timetable.js` | `TP_TIMETABLE` — 에브리타임 캡처 인식(격자·색 블록) + Tesseract.js OCR(과목명·강의실) |
| `css/app.css` | 전체 스타일. 휴대폰용 `@media (max-width: 640px)` 블록은 파일 맨 끝에 둔다 |
| `supabase/schema.sql` | 테이블, RLS, RPC 함수 전부. 여러 번 실행해도 안전하게 유지 |
| `manifest.webmanifest`, `icons/` | 홈 화면 앱 설치 |

모듈 시스템은 쓰지 않는다. 각 `js/*.js`는 IIFE로 `window.TP_*` 전역 하나를 내보내고, 페이지에서 `<script src>` 순서대로 불러온다. `file://`에서는 동작하지 않으니 로컬 서버로 연다.

## 로컬 실행

```
cd C:\Users\v\teamplay-calendar
python -m http.server 5500
```

http://localhost:5500 — `js/config.js`가 실제 Supabase를 가리키므로 로컬에서도 실데이터를 쓴다. 테스트 팀을 만들었으면 끝나고 정리한다(아래 '테스트').

## 데이터와 보안 규칙 (어기지 말 것)

- 브라우저는 테이블에 직접 접근하지 않는다. 모든 테이블은 RLS on + 정책 없음, `anon`/`authenticated` 권한 회수. 접근은 `security definer` RPC 함수로만 한다.
- 쓰기 RPC는 항상 `(p_member_id, p_token)`을 받고 `_member_team()`으로 확인한다. 팀 단위 리소스(후보·투표)는 그 팀 소속인지도 확인한다.
- `get_team` 응답에 `token`을 절대 넣지 않는다. 토큰은 `join_team` 응답에서 한 번만 나간다.
- `js/config.js`에는 publishable(anon) 키만 둔다. service_role/secret 키는 저장소 어디에도 넣지 않는다.
- 입력 검증은 클라이언트와 서버(SQL) 양쪽에서 한다. 서버 검증이 기준이다.
- 새 RPC를 추가하면 파일 끝의 `revoke`/`grant` 목록에도 시그니처를 추가한다.

### 스키마 변경 절차

Claude는 Supabase DDL을 직접 실행할 수 없다(키가 publishable뿐).

1. `supabase/schema.sql`을 고친다. `create table if not exists`, `add column if not exists`, `create or replace function`으로 재실행 안전하게.
2. 사용자에게 Supabase 대시보드 → SQL Editor에서 파일 전체를 실행해 달라고 요청한다. 클립보드 복사: `Get-Content supabase\schema.sql -Raw -Encoding utf8 | Set-Clipboard`
3. 실행됐다는 답을 받은 뒤, 실제 RPC로 검증하고 나서 프런트엔드를 push한다. 새 RPC를 쓰는 화면을 먼저 배포하면 오류가 난다.

## 도메인 규칙

- 일정(slot): `{ name, day: "MON".."SUN", start: "HH:MM", end: "HH:MM", location, kind: "class"|"personal", date: "YYYY-MM-DD"|null }`
  - `date`가 null이면 매주 반복, 있으면 그날만. `date`가 있으면 `day`는 그 날짜의 요일이어야 한다(서버가 검사).
  - `save_slots`는 본인 일정 **전체 교체**다. 일부만 보내면 나머지가 지워진다.
- 시간표 이미지를 다시 올리면 매주 반복 `class`만 바꾸고 `personal`과 날짜 지정 일정은 유지한다.
- 날짜는 브라우저 현지 시간(한국)으로 계산한다. 서버의 '오늘'은 `_today_kst()`. `toISOString()`으로 날짜를 만들지 않는다(UTC라 하루가 밀림).
- 팀 격자는 30분 칸(`STEP`), 빈 시간 계산은 5분(`FINE`). 이동 여유(`buffer`)는 빈 시간 계산에만 적용하고 격자 색칠에는 적용하지 않는다.
- 후보(`meeting_options`)는 오늘 이후 것만 `get_team`에 나온다. 확정은 `teams.confirmed_option_id`.

## 코드 관례

- UI 문구와 주석은 한국어. 사용자에게 보이는 오류 메시지도 한국어로, 해결 방법을 함께 적는다.
- 사용자 입력을 HTML에 넣을 때는 항상 `esc()`를 거친다.
- 외부 라이브러리는 정확한 버전으로 고정하고, 필요한 순간에만 불러온다(`tesseract.js@5.1.1` jsDelivr, `qrcodejs/1.0.0` cdnjs).
- 새 의존성이나 빌드 도구(npm, 번들러)를 들이지 않는다. 이 PC에는 Node가 없다.

### 겪었던 함정

- CSS 클래스 이름 충돌: 드래그 미리보기를 `.ghost`로 했다가 `button.ghost`와 겹쳐 '팀 나가기'·× 버튼이 눌리지 않았다. 지금은 `.drag-ghost`. 새 클래스는 기존 이름과 겹치는지 검색하고 만든다.
- 휴대폰 미디어 쿼리는 CSS 파일 **맨 끝**에 있어야 한다. 앞에 두면 뒤의 기본 규칙이 덮어쓴다.
- 격자 편집기는 `touch-action: pan-y`. 터치는 짧은 탭만 일정 추가로 처리하고, 끌면 스크롤되게 둔다(`pointerType !== "mouse"` 분기).
- 폼 요소 이름 `name`은 `form.name`을 가린다. 지금 코드는 이것에 기대고 있으니(`f.name.value`) 이름을 바꿀 때 주의.
- Windows PowerShell 5.1은 BOM 없는 UTF-8 `.ps1`을 ANSI로 읽어 안에 든 한글이 깨진다. 한글 HTML·JSON은 별도 파일로 두고 복사한다.
- Git Bash에서 `curl`로 한글 JSON을 보내면 깨진다. 한글이 든 API 테스트는 Python(`urllib`, UTF-8)으로 한다.

## 테스트

저장소에 자동 테스트는 아직 없다. 지금까지는 이렇게 검증했다.

- **실제 Supabase RPC**: Python 스크립트로 팀 생성 → 참여 → 저장 → 후보·투표·확정 → 다른 팀 접근 거부 → 테이블 직접 읽기 401 → 정리. 테스트 팀 이름에는 `(삭제예정)`을 붙이고, 팀원은 `leave_team`으로 지운다. 빈 팀 행은 남으니 사용자에게 알린다.
- **화면 동작**: Supabase RPC를 흉내 내는 로컬 목 서버(정적 파일 + `/rest/v1/rpc/*` + `js/config.js` 대체)를 띄우고, 헤드리스 Edge(`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe --headless=new`)로 테스트 페이지를 열어 결과를 목 서버로 POST 받는다. 테스트 페이지는 프로젝트 루트에 `__*.html`로 잠깐 복사했다가 지운다(커밋 금지).
- **휴대폰 레이아웃**: 헤드리스 Edge는 창 폭 500px 미만을 만들지 못한다. 390px 폭 `iframe`으로 감싼 페이지를 `--screenshot`으로 찍어 확인한다.
- **시간표 인식**: 사용자가 보낸 에브리타임 캡처(1206×1387)를 본뜬 합성 이미지(Pillow, 맑은 고딕)로 검증했다. 실제 캡처 파일로는 아직 검증하지 못했다.

변경 후 최소한: 바뀐 화면을 PC 폭과 390px 폭에서 확인하고, RPC나 스키마를 건드렸으면 실제 DB로 확인한다.

## 배포

- `main`에 push하면 Vercel이 배포한다. 배포 확인: `curl -s https://teamplay-calendar.vercel.app/<파일> | grep <새 코드의 문자열>`
- `vercel.json`은 `{"framework": null}`(빌드 없는 정적 사이트). `.vercelignore`로 `supabase/`, `README.md`는 배포에서 뺀다.
- 공유 주소는 `teamplay-calendar.vercel.app`이다. 배포마다 바뀌는 `...-sadfsa.vercel.app` 주소는 Vercel 로그인 보호가 걸려 있어 팀원에게 주면 안 된다.
- 커밋 작성자: `김범수 <caegyu@gmail.com>` (저장소 로컬 git config에 설정됨).
