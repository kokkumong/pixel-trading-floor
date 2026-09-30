// /project.zip 포함 목록 (P1-7-R14). 기본 비활성이고 로컬에서만 연다 (P0-7.4).
// 넣을 항목을 고르는 방식(BUNDLE_INCLUDE)이 1차, 비밀일 수 있는 이름을 빼는 방식(isExcluded)이 2차 방어선이다.
// 만들기 전에 이 목록을 화면에 보여주고, 사용자가 확인한 목록의 해시가 지금 목록과 같을 때만 만든다.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 프로젝트 루트에서 번들에 넣는 최상위 항목. 여기 없는 파일·폴더(개인 메모, 도구 설정 등)는 들어가지 않는다 */
export const BUNDLE_INCLUDE: readonly string[] = [
  'src', 'docs', 'config', 'fixtures', 'scripts', 'test', '.github', '.githooks',
  'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore', 'CLAUDE.md', 'CONVENTION.md', 'README.md',
  'start-floor.cmd', 'start-floor-lan.cmd', 'start-floor.command', 'start-floor-lan.command',
];

/** 번들 항목의 유닉스 권한. macOS 시작 파일(.command)은 받은 사람이 더블클릭으로 실행할 수 있게 755 (P2-7-R1) */
export function bundleFileMode(relPath: string): number {
  return relPath.endsWith('.command') ? 0o755 : 0o644;
}

/** 경로 조각 하나라도 걸리면 뺀다. .git은 원격 주소에 인증 정보가 들어 있을 수 있어 함께 뺀다 */
const EXCLUDED_SEGMENTS = [
  /^\.env/i, /^\.claude$/i, /credentials/i, /^node_modules$/i, /^reports$/i, /^jobs$/i, /^logs$/i, /\.key$/i, /\.pem$/i, /^\.git$/i,
  // P1-7-R14 목록 밖이지만 인증 정보가 흔히 들어 있는 이름 (보안 재검토)
  /^\.npmrc$/i, /^\.netrc$/i, /^\.ssh$/i, /^\.aws$/i, /^\.docker$/i, /^\.kube$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(p12|pfx|jks|keystore)$/i, /secret/i, /^\.floor$/i, /^\.DS_Store$/i,
];

export function isExcluded(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((seg) => EXCLUDED_SEGMENTS.some((re) => re.test(seg)));
}

export interface BundleList {
  files: { path: string; size: number }[];
  totalBytes: number;
  /** 경로·크기·수정 시각으로 만든 해시. 확인 화면과 다운로드 사이에 목록이 바뀌었는지 본다 */
  listHash: string;
}

/** 심볼릭 링크는 따라가지 않는다 (루트 밖 파일 방지) */
export function listBundleFiles(root: string): BundleList {
  const files: { path: string; size: number; mtimeMs: number }[] = [];
  const visit = (r: string) => {
    if (isExcluded(r)) return;
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(join(root, r));
    } catch {
      return; // 없는 항목 (README.md 등)
    }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) for (const name of readdirSync(join(root, r)).sort()) visit(`${r}/${name}`);
    else if (st.isFile()) files.push({ path: r, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
  };
  for (const top of [...BUNDLE_INCLUDE].sort()) visit(top);
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.path}\0${f.size}\0${f.mtimeMs}\n`);
  return { files: files.map(({ path, size }) => ({ path, size })), totalBytes: files.reduce((s, f) => s + f.size, 0), listHash: h.digest('hex').slice(0, 16) };
}
