// P1-6-T2: 리포트 저장 중 Markdown 이름 변경 직전에 프로세스를 강제 종료한다.
//   node test/fixtures/report-crash.ts <reports 디렉터리> <리포트 JSON 파일>
import { readFileSync } from 'node:fs';
import { ReportStore } from '../../src/core/report/store.ts';

const [dir, file] = process.argv.slice(2) as [string, string];
const store = new ReportStore(dir, { tzOffsetMinutes: 0, beforeMdRename: () => process.kill(process.pid, 'SIGKILL') });
store.save(JSON.parse(readFileSync(file, 'utf8')));
