# ui-sbs-viwer

SceneMaker SBS 공개 뷰어 — 업로드 영상 탐색 · 클립 편성 · 결과 재생.

## 실행

```bash
cp .env.local.example .env.local   # 실값 입력
npm install
npm run dev                        # http://localhost:3000
npm run build && npm start         # 운영
npm run typecheck
```

로컬 개발에서 S3 presigned 발급에 MFA 세션이 필요하다:

```bash
source ~/.claude/scripts/aws-mfa-auth.sh   # AWS_PROFILE=mfa
```

## 구조

```
app/            App Router 페이지 + API Route(얇게)
components/     화면 컴포넌트("use client" 는 상호작용이 필요한 것만)
lib/server/     DB·S3·agent 접근 — 전부 "server-only"
lib/domain/     상태코드·카테고리·길이 선택지 상수
lib/            공용 타입·포맷터(서버/클라이언트 공용, 순수 함수만)
proxy.ts        접근 통제 자리(현재 통과 — 로그인은 후순위)
sql/            DDL(이미 운영 DB 에 적용된 것들)
```

페이지 8개: `/`(대시보드) · `/videos` · `/clips` · `/v/[vid]` · `/c/[cid]` · `/upload`
(+ 후순위 `/login` · `/password`).

## 이 프로젝트에서 꼭 지킬 것

**1. `is_sbs` 는 존재 자체가 비공개다.**
노출 대상은 `t_video.is_sbs = 1` 뿐이고, 이 조건은 `lib/server/videos.ts`·`composes.ts` 의
SQL 에서만 적용한다. 어떤 응답 JSON·공유 타입·에러 메시지에도 이 컬럼을 싣지 않는다.
목록뿐 아니라 **단건 조회도** 걸러야 한다 — 주소창의 `v_id`·`comp_id` 는 바꿔 넣을 수 있다.
노출 대상이 아니면 "권한 없음"이 아니라 **404** 로 답한다.

**2. 이 앱은 DB 에 쓰지 않는다.**
운영 계정(`sm_viewer`)이 SELECT 전용이다. `lib/server/db.ts` 에 쓰기 헬퍼를 두지 않은 것도
그래서다. 렌더 결과(`render_datetime`·`bumper_yn`) 기록은 **agent-compose 담당**이다.

**3. 상태 판정은 `status_code` 로만 한다.**
`t_video.comment` 는 렌더 성공 후에도 옛 에러 문구가 남아 있는 사례가 실측됐다.

**4. `t_code` 문구를 그대로 쓰지 않는다.**
"하이라이트"·"자막"·"전광판" 같은 내부 용어가 들어 있다. `sanitizeCodeText()` 를 통과시키고,
파이프라인 4단계 이름은 `lib/domain/status.ts` 의 `PIPELINE_STAGES` 가 소유한다.

**5. 재생 시점에 렌더를 호출하지 않는다.**
worker-render(:8003)는 상시 가동이 아니다. 렌더는 사용자가 렌더 옵션 다이얼로그에서
확인을 누른 경우에만 일어난다. 실패(502)는 정상 시나리오이며 편성은 그대로 남는다.

**6. 편성 동시 처리는 UI 서버 전역 1건이다.**
`lib/server/compose-agent.ts` 의 모듈 스코프 잠금이다 — **단일 프로세스 전제**.
PM2 클러스터로 띄우면 무력해진다. 배포는 systemd 단일 프로세스로 고정한다.

**7. 길이(`budget`)는 목표가 아니라 상한이다.**
900초 요청이 311초로 나온 실측이 있다. 화면 문구는 "최대 N분".

## 관련 문서 (로컬 전용, git 미추적)

- `PAGES.md` — 페이지·기능 명세, 결정 사항의 정본
- `RESEARCH.md` — 사전 조사(DB·API·인프라 실측)
- `DEPLOY_GUIDE.md` — sm-pub-01 구축 가이드
- `REQUEST_agent-compose.md` — agent-compose 수정 요청서
- `design/mockup.pen` — 디자인 목업(토큰은 `app/globals.css` 와 1:1)
