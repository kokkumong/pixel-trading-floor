#!/bin/bash
# PIXEL TRADING FLOOR 시작 - 이 PC 전용 (macOS, P2-7)
# Finder에서 더블클릭하면 터미널 창이 열리고 서버가 토큰이 든 주소로 기본 브라우저를 엽니다.
# 서버 출력은 이 창에만 표시하고 파일로 남기지 않습니다. 이 창을 닫거나 Ctrl+C를 누르면 서버가 꺼집니다.
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

echo "PIXEL TRADING FLOOR를 시작합니다. 이 창을 닫으면 서버가 꺼집니다."
node src/server/main.ts --open --doctor || pause
