#!/bin/bash
# PIXEL TRADING FLOOR 시작 - 같은 네트워크의 다른 기기에서 보기 (macOS, P2-7)
# 서버 출력(다른 기기용 토큰 주소 포함)은 이 창에만 표시하고 파일로 남기지 않습니다.
cd "$(dirname "$0")" || exit 1

pause() { [ -t 0 ] && read -r -p "Enter를 누르면 창을 닫습니다... " _; }

# 22.18 이상인 node인지 본다 (타입 제거 실행에 필요)
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }

# Finder에서 연 창은 셸 설정을 읽지 않아 PATH가 짧거나 오래된 node가 먼저 잡힐 수 있다:
# Homebrew(node@22 등)·Volta·nvm으로 설치한 node 중 조건에 맞는 첫 번째를 쓴다. FLOOR_NODE_SEARCH는 테스트용 탐색 목록
if ! command -v node >/dev/null 2>&1 || ! node_ok node; then
  for d in ${FLOOR_NODE_SEARCH-/opt/homebrew/bin /usr/local/bin $HOME/.volta/bin /opt/homebrew/opt/node*/bin /usr/local/opt/node*/bin}; do
    if [ -x "$d/node" ] && node_ok "$d/node"; then export PATH="$d:$PATH"; break; fi
  done
fi
if { ! command -v node >/dev/null 2>&1 || ! node_ok node; } && [ -z "${FLOOR_NODE_SEARCH+x}" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 없습니다. https://nodejs.org 에서 22.18 이상 LTS를 설치한 뒤 다시 실행하세요."
  pause
  exit 1
fi
if ! node_ok node; then
  echo "설치된 Node.js $(node -p 'process.versions.node' 2>/dev/null)는 이 앱을 실행할 수 없습니다. https://nodejs.org 에서 22.18 이상 LTS를 설치한 뒤 다시 실행하세요."
  pause
  exit 1
fi

echo "============================================================"
echo " 다른 기기에서 보기 모드"
echo " - 집이나 사무실의 신뢰할 수 있는 Wi-Fi에서만 쓰세요. 공용·게스트 Wi-Fi 금지"
echo " - 다른 기기는 화면과 리포트를 읽기 전용으로만 봅니다. 분석 실행은 이 PC에서"
echo " - 접속 주소는 아래 서버 출력에 표시되고 2시간 뒤 만료됩니다"
echo " - 방화벽이 들어오는 연결 허용을 물으면 허용하세요 (집·사무실 네트워크에서만)"
echo "============================================================"
node src/server/main.ts --lan --open --doctor || pause
