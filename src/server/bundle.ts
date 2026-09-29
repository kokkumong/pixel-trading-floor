// /project.zip 포함 목록 (P1-7-R14). 기본 비활성이고 로컬에서만 연다 (P0-7.4).
// 만들기 전에 이 목록을 화면에 보여주고, 사용자가 확인한 목록의 해시가 지금 목록과 같을 때만 만든다.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** 경로 조각 하나라도 걸리면 뺀다. .git은 원격 주소에 인증 정보가 들어 있을 수 있어 함께 뺀다 */
const EXCLUDED_SEGMENTS = [
  /^\.env/i, /^\.claude$/i, /credentials/i, /^node_modules$/i, /^reports$/i, /^jobs$/i, /^logs$/i, /\.key$/i, /\.pem$/i, /^\.git$/i,
];

export function isExcluded(relPath: string): boolean {
  return relPath.split(/[/\\]/).some((seg) => EXCLUDED_SEGMENTS.some((re) => re.test(seg)));
}

export interface BundleList {
  files: { path: string; size: number }[];
  totalBytes: number;
  /** 경로와 크기로 만든 해시. 확인 화면과 다운로드 사이에 목록이 바뀌었는지 본다 */
  listHash: string;
}

/** 심볼릭 링크는 따라가지 않는다 (루트 밖 파일 방지) */
export function listBundleFiles(root: string): BundleList {
  const files: { path: string; size: number }[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (isExcluded(r)) continue;
      const st = lstatSync(join(root, r));
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) files.push({ path: r, size: st.size });
    }
  };
  walk('');
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.path}\0${f.size}\n`);
  return { files, totalBytes: files.reduce((s, f) => s + f.size, 0), listHash: h.digest('hex').slice(0, 16) };
}
