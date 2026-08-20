#!/usr/bin/env bash
# ui-sbs-viwer 자체 업데이트 — GitHub origin/main 최신으로 갱신 후 빌드·재기동.
# (agent-compose deploy/update.sh 계승 — uv sync 자리에 npm ci + next build 가 들어간다)
#
# 사용(sm-pub-01, ec2-user 등 sudo 가능 계정에서):
#   deploy/update.sh            # 변경 없으면 아무것도 안 하고 종료
#   deploy/update.sh --force    # 변경 없어도 재빌드 + 재기동 강제
#
# 전제:
#   - 배포 디렉토리가 GitHub 를 origin(ssh 별칭 + read-only deploy key) 으로 둔 git clone, 소유자 ui
#   - .env 는 gitignore(미추적)라 reset --hard 에도 보존된다
#   - .cache/thumbs(썸네일 캐시)도 미추적이라 보존된다
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE=sbs-viewer.service
UNIT_SRC="$APP_DIR/deploy/sbs-viewer.service"
UNIT_DST="/etc/systemd/system/$SERVICE"
BRANCH=main
RUN_AS=ui

# 소유 계정으로 실행 (deploy key 는 ui 의 ~/.ssh 에 있다)
as_owner() { sudo -u "$RUN_AS" -H "$@"; }
GIT=(as_owner git -C "$APP_DIR")

"${GIT[@]}" fetch origin "$BRANCH"
LOCAL=$("${GIT[@]}" rev-parse HEAD)
REMOTE=$("${GIT[@]}" rev-parse "origin/$BRANCH")
if [[ "$LOCAL" == "$REMOTE" && "${1:-}" != "--force" ]]; then
    echo "이미 최신입니다($("${GIT[@]}" rev-parse --short HEAD)) — 종료 (강제하려면 --force)"
    exit 0
fi

echo "업데이트: $("${GIT[@]}" rev-parse --short HEAD) → $("${GIT[@]}" rev-parse --short "origin/$BRANCH")"
# 서버 로컬 수정을 버리고 원격 main 을 정본으로 강제 일치(.env·.cache 등 미추적 파일은 보존)
"${GIT[@]}" reset --hard "origin/$BRANCH"

# 의존성 — package-lock.json 그대로 재현(잠금 갱신은 개발 머신 몫).
# next build 에 tailwind·typescript 가 필요해서 devDependencies 까지 설치한다.
(cd "$APP_DIR" && as_owner npm ci --include=dev)

# 프로덕션 빌드 — 여기서 실패하면 재기동하지 않고 중단(구 버전이 계속 서비스)
(cd "$APP_DIR" && as_owner env NODE_ENV=production npm run build)

# systemd 유닛이 저장소 버전과 다르면 갱신(멱등)
if ! cmp -s "$UNIT_SRC" "$UNIT_DST" 2>/dev/null; then
    sudo install -m644 "$UNIT_SRC" "$UNIT_DST"
    sudo systemctl daemon-reload
    echo "systemd 유닛 갱신됨"
fi

sudo systemctl restart "$SERVICE"

# 헬스 확인 — 최대 30초 대기. next start 는 즉시 리슨하지만 첫 컴파일이 있다.
PORT=$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 | awk '{print $1}')
PORT=${PORT:-3000}
for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
        echo "배포 완료: $("${GIT[@]}" rev-parse --short HEAD) / HTTP OK (port ${PORT})"
        exit 0
    fi
    sleep 1
done

# 뷰어 첫 페이지는 DB(t_video) 조회를 포함한다 — DB 사설 접근이 막히면
# 프로세스가 정상 기동해도 여기서 실패할 수 있다. 원인을 갈라 안내.
echo "경고: HTTP 무응답 — 프로세스 기동 여부와 DB 접근을 확인하라." >&2
echo "  systemctl status ${SERVICE} / journalctl -u ${SERVICE} -n 50" >&2
exit 1
