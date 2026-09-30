@echo off
chcp 65001 >nul
rem PIXEL TRADING FLOOR 시작 - 이 PC 전용 (P0-7.6)
rem 서버가 토큰이 든 주소로 기본 브라우저를 엽니다. 서버 출력은 이 창에만 표시하고 파일로 남기지 않습니다.
rem 이 창을 닫거나 Ctrl+C를 누르면 서버가 꺼집니다.
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js가 없습니다. https://nodejs.org 에서 22.18 이상 LTS를 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" >nul 2>nul || (
  echo 설치된 Node.js는 이 앱을 실행할 수 없습니다. https://nodejs.org 에서 22.18 이상 LTS를 설치한 뒤 다시 실행하세요.
  node -v
  pause
  exit /b 1
)
echo PIXEL TRADING FLOOR를 시작합니다. 이 창을 닫으면 서버가 꺼집니다.
node src\server\main.ts --open --doctor
pause
