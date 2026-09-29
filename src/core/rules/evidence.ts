// 근거 참조 문법과 존재 검사 (P1 명세 10.2).
//   snap:<sourceId>#<JSON 포인터>   스냅샷 원자료
//   derived:<지표명>               코드 계산 지표
//   brief:<역할>#<claimId>          같은 작업의 브리핑 주장

export type EvidenceRef =
  | { kind: 'snap'; sourceId: string; pointer: string }
  | { kind: 'derived'; name: string }
  | { kind: 'brief'; role: string; claimId: string };

const SNAP = /^snap:([A-Za-z0-9._-]+)#(\/.*)?$/;
const DERIVED = /^derived:([A-Za-z0-9_.]+)$/;
const BRIEF = /^brief:([A-Z]+)#(c\d{1,2})$/;

export function parseRef(ref: string): EvidenceRef | null {
  let m = SNAP.exec(ref);
  if (m) return { kind: 'snap', sourceId: m[1]!, pointer: m[2] ?? '' };
  m = DERIVED.exec(ref);
  if (m) return { kind: 'derived', name: m[1]! };
  m = BRIEF.exec(ref);
  if (m) return { kind: 'brief', role: m[1]!, claimId: m[2]! };
  return null;
}

/** RFC 6901 JSON 포인터. 빈 문자열은 문서 전체. 없는 경로면 undefined. */
export function resolvePointer(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  let cur: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(key)) return undefined;
      cur = cur[Number(key)];
    } else if (typeof cur === 'object' && cur !== null && Object.hasOwn(cur, key)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

export interface EvidenceIndex {
  has(ref: string): boolean;
}

export interface EvidenceSources {
  /** 스냅샷 sources[].id → payload (상태가 failed인 소스는 넣지 않는다) */
  snapshot: Record<string, unknown>;
  /** derived.indicators 등 코드 계산 값. 값이 null이면 근거로 인정하지 않는다 */
  derived: Record<string, unknown>;
  /** 역할 → 그 역할 브리핑의 claimId 목록 */
  briefs: Record<string, readonly string[]>;
}

export function createEvidenceIndex(src: EvidenceSources): EvidenceIndex {
  return {
    has(ref) {
      const r = parseRef(ref);
      if (!r) return false;
      switch (r.kind) {
        case 'snap':
          if (!Object.hasOwn(src.snapshot, r.sourceId)) return false;
          return resolvePointer(src.snapshot[r.sourceId], r.pointer) !== undefined;
        case 'derived': {
          const v = resolvePointer(src.derived, '/' + r.name.split('.').join('/'));
          return v !== undefined && v !== null;
        }
        case 'brief':
          return src.briefs[r.role]?.includes(r.claimId) ?? false;
      }
    },
  };
}
