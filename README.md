# 팀플 캘린더

팀원들의 수업 시간표를 모아 모두 비는 시간을 찾아 주는 웹 서비스.

- 에브리타임 시간표 캡처를 올리면 수업 시간을 자동 인식 (브라우저 안에서 처리, 무료)
- 격자에서 드래그로 직접 입력/수정
- 초대 코드로 팀원 참여, 공통 빈 시간 자동 계산

## 구조

| 경로 | 내용 |
|---|---|
| `index.html` | 홈 (팀 만들기 / 코드로 참여) |
| `team.html` | 팀 페이지 (`team.html?c=초대코드`) |
| `js/config.js` | Supabase URL·키 설정 |
| `js/api.js` | Supabase RPC 호출 |
| `js/timetable.js` | 시간표 이미지 인식 |
| `js/scheduler.js` | 공통 빈 시간 계산 |
| `supabase/schema.sql` | DB 테이블과 함수 |
| `vercel.json` | Vercel 설정 (빌드 없는 정적 사이트) |

## 설정

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. **SQL Editor**에 `supabase/schema.sql` 전체를 붙여 넣고 **Run**
3. **Project Settings → API**에서 Project URL과 anon(publishable) 키를 `js/config.js`에 입력
4. GitHub에 push → [vercel.com](https://vercel.com)에서 저장소 Import → Framework Preset은 **Other**, 나머지 기본값으로 Deploy

## 로컬 실행

```
python -m http.server 5500
```
→ http://localhost:5500
