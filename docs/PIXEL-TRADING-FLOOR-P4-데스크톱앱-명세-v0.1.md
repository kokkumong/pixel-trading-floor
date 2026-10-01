# PIXEL TRADING FLOOR P4 데스크톱 앱 명세 v0.1

- 작성일: 2026-10-01
- 문서 버전: v0.1 (초안)
- 최근 개정: 2026-10-01
- 선행 문서: `PIXEL-TRADING-FLOOR-P0-명세-v*.md`(보안 7장), `PIXEL-TRADING-FLOOR-P1-명세-v*.md`(P1-7 claude 호출), `PIXEL-TRADING-FLOOR-가이드-v*.md`
- 문서 성격: 지인 몇 명에게 나눠 줄 **Electron 데스크톱 앱**(맥 먼저, 윈도우는 맥 뒤)의 구조·보안·패키징을 정의한다. 분석 기능은 바꾸지 않는다.
- 제외 범위: 앱스토어 배포, 자동 업데이트, 코드 서명·공증(개발자 계정), 데스크톱 앱 안의 LAN 공유 화면

> 표기 규칙: P0 명세와 같다. **반드시(MUST)**, **권장(SHOULD)**, **선택(MAY)**. 요구사항 ID는 `P4-<항목번호>-R<번호>`, 검증 항목 ID는 `P4-<항목번호>-T<번호>`.

## 개정 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v0.1 | 2026-10-01 | 최초 명세. Phase 19 스파이크 실측(Electron 44.5.1·Node 24.21)을 근거로 셸 구조, 데이터 위치, claude 탐색, 창 보안, 패키징 정의 |

## 0. 배경과 결정

사용자 결정(2026-10-01): 혼자 쓰다가 **지인에게만** 배포한다. 래퍼 `.app`(브라우저로 열기) 대신 **Electron**으로 간다. 맥 먼저, 윈도우는 뒤에 한다.

| ID | 결정 | 이유 |
|---|---|---|
| D1 | 데스크톱 셸은 `desktop/` 하위 패키지에 둔다. 루트 `package.json`에는 Electron을 넣지 않는다 | 루트의 "런타임 의존성 0개·빌드 없음"과 `npm run verify`를 그대로 지킨다 |
| D2 | `src/server`·`src/web`·`src/core`는 Electron을 모른다. 셸이 `startServer`를 불러 주소만 창에 띄운다 | 브라우저·`/floor`·CLI 경로를 그대로 유지한다 |
| D3 | 데이터는 앱 데이터 폴더(`FLOOR_HOME`)에 둔다 | 앱을 덮어써도 기록이 남는다 |
| D4 | Node.js는 Electron에 내장된 것을 쓴다. 지인은 Node를 설치하지 않는다 | 지인 부담 제거 (Electron을 고른 이유) |
| D5 | `claude` CLI는 지인이 직접 설치·로그인한다. 앱은 찾고, 없으면 안내한다 | CLI는 앱에 넣을 수 없다 |
| D6 | 서명·공증 없이 배포한다. 처음 한 번 "열기" 허용을 안내한다 | 개발자 계정 비용을 피한다 |
| D7 | 맥은 arm64와 x64를 따로 만든다. 윈도우는 맥 실기 확인 뒤에 한다 | 사용자 결정 |
| D8 | 업데이트는 새 설치 파일을 직접 전달한다 | 자동 업데이트는 서명이 필요하다 |

### 0.1 스파이크 실측 (Phase 19, 맥 arm64)

- Electron 44.5.1은 Node **24.21.0**을 내장한다. `.ts` 타입 제거 실행이 **된다**. 메인 프로세스에서 `import()`로 `src/server/main.ts`를 불러 `startServer`가 동작하고, `ELECTRON_RUN_AS_NODE=1`로 `node`처럼 실행해도 된다.
- `--port 0`(임시 포트)이 되고, `started.localUrl()`을 `BrowserWindow.loadURL`로 열면 접속 쿠키가 생기고 화면(`PIXEL TRADING FLOOR`)이 뜬다.
- `app.asar` 안에 `src`·`config`·`fixtures`를 넣고 실행해도 `.ts` 로드·서버 기동·창 로드가 된다. 다만 정식 패키징된 앱(`app.isPackaged`)에서의 확인은 Phase 22 몫이다.
- PATH가 `/usr/bin:/bin:/usr/sbin:/sbin`뿐인 환경(Finder 실행과 같은 조건)에서도 기존 `findClaudeExecutable`이 `~/.local/bin/claude`를 찾는다. 로그인 셸(`$SHELL -lic 'printf %s "$PATH"'`)의 PATH를 빌려 와도 같은 결과다.
- Electron 44는 `npm install`만으로는 바이너리를 내려받지 않는다. `node node_modules/electron/install.js`를 따로 실행해야 한다 (CI 단계에 넣는다). 개발용 `Electron.app`은 약 307MB, `app.asar`(src·config·fixtures)는 약 2.4MB다.
- 개발용 Electron이 stderr에 `task_name_for_pid` 오류 한 줄을 찍지만 동작에는 영향이 없었다.
- **윈도우 위험**: `claude`가 npm 설치(`.cmd`)일 때 `findClaudeExecutable`은 `process.execPath`(Electron 실행 파일)로 `cli.js`를 실행한다. `buildChildEnv`가 `ELECTRON_RUN_AS_NODE`를 걸러 내서 Node 대신 앱이 한 번 더 뜬다. 맥의 네이티브 설치에는 영향이 없다. 윈도우 단계에서 다룬다.

## 1. 셸 구조 (P4-1)

- **P4-1-R1** `desktop/main.cjs`(메인 프로세스)는 `src/server/main.ts`의 `startServer`를 불러 서버를 켠다. 포트는 `0`(임시)이고, 창은 `started.localUrl()`로 연다.
- **P4-1-R2** 서버·웹·코어 코드에 Electron 참조(`require('electron')`)를 **넣지 않는다**. 셸 전용 로직 중 테스트할 수 있는 것(경로 결정, claude 탐색, URL 검사)은 Electron 없이 import할 수 있는 순수 모듈로 분리하고 루트 `test/`에서 검증한다.
- **P4-1-R3** 앱 이름은 `PIXEL TRADING FLOOR`로 고정한다(`app.setName`). 저장 폴더·창 제목·독 이름이 이 이름을 쓴다.
- **P4-1-R4** 앱이 이미 실행 중이면 두 번째 실행은 기존 창을 앞으로 가져오고 끝낸다(`requestSingleInstanceLock`).
- **P4-1-R5** 모든 창이 닫히면 서버를 종료하고 앱을 끝낸다(맥 포함). 종료 때 `shutdown()`을 부른다. 실행 중인 분석이 있으면 창을 닫기 전에 "분석이 취소됩니다" 확인을 받는다.
- **P4-1-R6** 서버 창 대신 콘솔이 없다. 서버 출력은 메뉴의 "서버 로그 보기"에서 볼 수 있고 파일로 남기지 않는다(토큰이 들어 있다).
- **P4-1-R7** 맥에서 복사·붙여넣기·실행 취소가 동작하도록 기본 편집 메뉴를 둔다.

## 2. 데이터 위치 (P4-2)

- **P4-2-R1** 서버 `root`는 `app.getPath('userData')` 아래 `data/` 폴더로 하고, `FLOOR_HOME`에 그 경로를 넘긴다. 맥: `~/Library/Application Support/PIXEL TRADING FLOOR/data/`, 윈도우: `%APPDATA%\PIXEL TRADING FLOOR\data\`. Electron이 `userData`에 캐시·쿠키를 함께 쓰므로 데이터는 `data/`로 분리한다.
- **P4-2-R2** 읽기 전용 자원(`src/web`, `fixtures/demo`, `config`)은 앱 안에서 읽고, 쓰는 것(`jobs/`, `reports/`, `.floor/`)은 모두 `FLOOR_HOME`에만 쓴다. 앱 폴더에는 쓰지 않는다.
- **P4-2-R3** 기존 프로젝트 폴더의 데이터(`jobs/`, `reports/`, `.floor/positions.json`)는 자동으로 옮기지 않는다. 가이드가 폴더를 복사하는 방법을 안내한다(Phase 23). 새 버전이 옛 데이터를 읽는 호환은 기존 스키마 읽기 호환이 담당한다.
- **P4-2-R4** 설정 화면에서 데이터 폴더를 열 수 있다(`shell.showItemInFolder`). 경로를 `shell.openPath`에 넘길 때는 `FLOOR_HOME` 하위인지 확인한다.

## 3. claude 탐색과 안내 (P4-3)

- **P4-3-R1** 탐색 순서: `FLOOR_CLAUDE_PATH` → `PATH` → `~/.local/bin`, `~/.claude/local`(기존 `findClaudeExecutable`) → 로그인 셸의 `PATH`(8초 제한, 실패해도 무시) → 추가 후보 폴더(Homebrew `/opt/homebrew/bin`·`/usr/local/bin`, nvm·Volta의 npm 전역 bin).
- **P4-3-R2** 찾으면 그 경로를 `FLOOR_CLAUDE_PATH`로 서버 환경에 넘긴다. 로그인 셸의 `PATH`를 환경 전체로 복사하지 않는다(자식 프로세스 환경은 기존 `buildChildEnv` 허용 목록을 따른다).
- **P4-3-R3** 못 찾으면 창 위에 안내를 띄운다: "claude CLI가 필요합니다. 설치 후 터미널에서 `claude`로 로그인한 뒤 앱을 다시 여세요." 데모·리포트·포지션 입력은 그대로 쓸 수 있게 서버는 켠다(P2-7 doctor 원칙).
- **P4-3-R4** 시작 시 doctor는 기존 `startupDoctor`를 쓰고, 결과를 창의 진단 화면(`/diagnostics`)과 같은 내용으로 보여 준다. 인증 점검은 호출 시간 제한을 둔다(CLAUDE.md "claude 실행은 호출 시간 제한 필수").
- **P4-3-R5** 윈도우 npm 설치 `.cmd` 경로는 맥 이후 단계에서 다룬다. `process.execPath`가 Electron일 때의 처리는 그때 정한다 (§0.1 윈도우 위험).

## 4. 창과 보안 (P4-4)

P0 7장의 보안 경계를 그대로 지킨다. 서버는 `127.0.0.1`에만 묶고 토큰·쿠키 방식을 바꾸지 않는다.

- **P4-4-R1** 창 설정: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. preload는 쓰지 않는다. 웹 화면이 Node·Electron API에 접근하는 경로가 없다.
- **P4-4-R2** 창은 서버 origin(`http://localhost:<포트>`)만 연다. 다른 주소로의 이동(`will-navigate`, `will-redirect`)과 새 창(`setWindowOpenHandler`)은 막는다. 새 창 요청 중 `https:` 주소는 확인 없이 기본 브라우저로 넘기고, 그 밖의 프로토콜은 버린다.
- **P4-4-R3** 접속 토큰은 메모리에만 둔다. 창은 `localUrl()`로 한 번 열어 쿠키를 받는다. 토큰이 든 주소를 로그·오류 화면·클립보드에 쓰지 않는다.
- **P4-4-R4** 서버는 `--lan`으로 켜지 않는다. 데스크톱 앱에는 LAN 공유 기능이 없다(제외 범위).
- **P4-4-R5** 개발자 도구와 원격 디버깅 포트(`--remote-debugging-port`)는 패키징본에서 막는다. 패키징본은 Electron fuses로 `RunAsNode`·`NODE_OPTIONS`·`--inspect` 인자를 끈다. `[구현 시 결정]` 윈도우 `.cmd` 처리(P4-3-R5)가 `RunAsNode`에 기대면 그 단계에서 다시 정한다.
- **P4-4-R6** 외부 요청은 계속 `src/core/data/net.ts`(도메인 허용 목록)만 거친다. 셸은 추가 외부 요청(업데이트 확인, 원격 분석 등)을 하지 않는다.

## 5. 패키징 (P4-5)

- **P4-5-R1** 빌더는 `desktop/` 안에서 electron-builder를 쓴다(devDependency). 앱에 포함하는 것은 `desktop/main.cjs`, `src/`, `config/`, `fixtures/demo/`, 루트 `package.json`(`type: module` 때문)이다. `test/`, `docs/`, `jobs/`, `reports/`, `.floor/`, `.env*`는 **넣지 않는다**.
- **P4-5-R2** 맥 산출물: `.dmg` 두 개(`arm64`, `x64`). 앱 이름·아이콘·번들 ID(`com.kokkumong.pixel-trading-floor`)를 고정한다. 서명이 없어도 Apple Silicon에서 실행되도록 ad-hoc 서명이 되는지 확인한다.
- **P4-5-R3** CI(GitHub Actions)는 `macos-latest`에서 맥용을 만든다. 빌드 전에 `node node_modules/electron/install.js` 단계를 넣는다. 윈도우용 빌드는 맥 실기 확인 뒤에 추가한다.
- **P4-5-R4** 패키징본에서도 `.ts` 로드가 되는지 `app.isPackaged === true` 상태로 확인한다(§0.1). 안 되면 `asar: false`로 바꾼다.
- **P4-5-R5** 설치 파일은 저장소가 Private이라 Releases로 지인이 내려받을 수 없다. 전달은 파일 공유로 한다.

## 6. 검증 항목

- **P4-1-T1** 서버·웹·코어 소스에 `electron` 참조가 없다 (소스 검사 테스트).
- **P4-2-T1** `FLOOR_HOME`을 임시 폴더로 준 서버가 `jobs/`·`reports/`·`.floor/`를 그 폴더 안에만 만들고 앱(프로젝트) 폴더에는 쓰지 않는다.
- **P4-2-T2** `showItemInFolder`·`openPath` 대상이 `FLOOR_HOME` 밖이면 거부한다 (순수 함수 테스트).
- **P4-3-T1** `PATH`가 `/usr/bin:/bin`뿐인 환경에서도 `~/.local/bin/claude`가 있으면 찾는다.
- **P4-3-T2** `PATH`에 없고 후보 폴더(nvm·Volta·Homebrew)에만 있어도 찾고, 없으면 `null`을 돌려 안내가 뜬다.
- **P4-3-T3** 로그인 셸 호출이 8초 안에 끝나지 않거나 실패해도 탐색은 계속되고 앱은 멈추지 않는다.
- **P4-4-T1** 서버 origin이 아닌 주소로의 이동·`http:`·`file:`·`javascript:` 새 창 요청은 모두 거부된다 (URL 검사 순수 함수 테스트).
- **P4-4-T2** 패키징본의 `webPreferences`가 R1 값이다 (설정 객체를 만드는 순수 함수 테스트).
- **P4-5-T1** 패키징 설정의 포함 목록에 `test/`, `docs/`, `jobs/`, `reports/`, `.floor/`, `.env*`가 없다 (설정 검사 테스트).
- **P4-5-T2** (수동 스모크) 정식 패키징된 맥 앱을 더블클릭해 창이 뜨고, 데모와 실제 분석 1회가 되고, 창을 닫으면 프로세스가 남지 않는다.

## 7. 구현 Phase

| Phase | 내용 | 검증 |
|---|---|---|
| 19 | 스파이크와 이 명세 | (이 문서) |
| 20 | 데스크톱 셸: 메인 프로세스, 서버 기동·종료, 창 보안, 단일 인스턴스, 메뉴, `FLOOR_HOME` | P4-1-*, P4-2-T1·T2, P4-4-T1·T2 |
| 21 | claude 탐색 확장·안내·doctor 연동 | P4-3-* |
| 22 | electron-builder 패키징(맥 arm64·x64), 아이콘, CI | P4-5-T1, R4 확인 |
| 23 | 가이드 v1.9, 맥 실기 스모크 → **P4 맥 끝** | P4-5-T2 |

## 8. 결정 기록과 남은 불확실성

1. Electron 번들은 크다(개발용 307MB, 설치 파일은 더 작지만 100MB대 예상). 지인용 한정이라 감수한다.
2. 서명이 없는 앱은 인터넷으로 받으면 격리 속성(quarantine) 때문에 처음 실행이 막힌다. Control-클릭 → 열기, 또는 `xattr -cr`을 안내한다. ad-hoc 서명이 arm64에서 충분한지는 Phase 22 실측 과제다.
3. 윈도우: 설치 파일 빌드, SmartScreen 경고, `claude` `.cmd` 실행(§0.1)은 맥 이후다. 윈도우 PC가 없으면 CI 빌드까지만 하고 지인 PC에서 확인한다.
4. Electron 주 버전이 빨리 올라간다(스파이크 시점 44.5.1). 번들된 Node가 22.18 미만으로 내려가는 일은 없지만, 업그레이드 때마다 `.ts` 로드 확인을 반복한다.
5. 앱 내 LAN 공유·자동 업데이트·서명은 필요가 생기면 별도 Phase로 다룬다.
