// 테스트용 가짜 claude CLI. 표준 입력의 "#MODE=<이름>"으로 동작을 고른다.
import { readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const mode = /#MODE=(\w+)/.exec(input)?.[1] ?? 'ok';
  const out = (o, code = 0) => process.stdout.write(JSON.stringify(o), () => process.exit(code));
  const ok = (structured) => out({
    type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(structured), structured_output: structured,
    usage: { input_tokens: 1200, output_tokens: 80 }, total_cost_usd: 0.001, modelUsage: { 'claude-fake-1': {} },
  });
  switch (mode) {
    case 'ok': return ok({ hello: 'world' });
    case 'env': return ok({ env: Object.keys(process.env), cwd: process.cwd(), cwdEntries: readdirSync(process.cwd()), args: process.argv.slice(2) });
    case 'auth': return out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', api_error_status: 401 }, 1);
    case 'quota': return out({ type: 'result', subtype: 'success', is_error: true, result: 'Claude usage limit reached. Your limit will reset at 5pm', api_error_status: 429 }, 1);
    case 'garbage': process.stderr.write('segmentation fault\n'); process.stdout.write('not json'); process.exit(3);
    case 'long': return ok({ text: 'x'.repeat(50_000) });
    case 'hang': {
      // 손자 프로세스를 만들고 PID를 기록한 뒤 응답하지 않는다 (프로세스 트리 종료 확인용)
      const pidFile = /#PIDFILE=(\S+)/.exec(input)?.[1];
      const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      if (pidFile) writeFileSync(pidFile, JSON.stringify({ child: process.pid, grandchild: gc.pid }));
      setInterval(() => {}, 1000);
      return;
    }
  }
});
