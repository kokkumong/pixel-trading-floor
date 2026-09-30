@echo off
chcp 65001 >nul
rem PIXEL TRADING FLOOR 시작 - 같은 네트워크의 다른 기기에서 보기 (P0-7.6)
rem 서버 출력(다른 기기용 토큰 주소 포함)은 이 창에만 표시하고 파일로 남기지 않습니다.
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
echo ============================================================
echo  다른 기기에서 보기 모드
echo  - 집이나 사무실의 신뢰할 수 있는 Wi-Fi에서만 쓰세요. 공용·게스트 Wi-Fi 금지
echo  - 다른 기기는 화면과 리포트를 읽기 전용으로만 봅니다. 분석 실행은 이 PC에서
echo  - 접속 주소는 아래 서버 출력에 표시되고 2시간 뒤 만료됩니다
echo  - 방화벽 허용을 물으면 개인 네트워크만 허용하세요
echo ============================================================
node src\server\main.ts --lan --open --doctor
pause
