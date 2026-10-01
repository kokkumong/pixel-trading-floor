// 작은 스키마 DSL: 한 번 정의하면 TS 타입(Infer), 런타임 검증(parse), claude --json-schema용 JSON 스키마(toJsonSchema)가 함께 나온다.
// 검증 오류에는 명세 규칙 코드(V-PARSE, V-CONF, V-POSITIVE 등)를 붙인다.

export interface SchemaError {
  code: string;
  path: string;
  message: string;
}

interface Base {
  readonly description?: string;
  /** 이 노드에서 난 오류에 붙일 규칙 코드. 없으면 상위 노드의 코드를 쓰고, 최상위 기본값은 V-PARSE */
  readonly code?: string;
  /** 객체 필드가 없을 때 채울 값. 이전 버전 출력 읽기용이며 JSON 스키마에서는 여전히 필수 필드다 */
  readonly default?: unknown;
}
export interface StrS extends Base {
  readonly kind: 'string';
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}
export interface EnumS<V extends readonly string[]> extends Base {
  readonly kind: 'enum';
  readonly values: V;
}
export interface NumS extends Base {
  readonly kind: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: number;
}
export interface IntS extends Base {
  readonly kind: 'integer';
  readonly min?: number;
  readonly max?: number;
}
export interface BoolS extends Base {
  readonly kind: 'boolean';
}
export interface ArrS<I extends Schema> extends Base {
  readonly kind: 'array';
  readonly items: I;
  readonly minItems?: number;
  readonly maxItems?: number;
}
export interface ObjS<P extends Record<string, Schema>> extends Base {
  readonly kind: 'object';
  readonly props: P;
}
export interface NullS<I extends Schema> extends Base {
  readonly kind: 'nullable';
  readonly inner: I;
}

export type Schema =
  | StrS
  | EnumS<readonly string[]>
  | NumS
  | IntS
  | BoolS
  | ArrS<any>
  | ObjS<Record<string, any>>
  | NullS<any>;

export type Infer<S> = S extends StrS
  ? string
  : S extends EnumS<infer V>
    ? V[number]
    : S extends NumS | IntS
      ? number
      : S extends BoolS
        ? boolean
        : S extends ArrS<infer I>
          ? Infer<I>[]
          : S extends ObjS<infer P>
            ? { [K in keyof P]: Infer<P[K]> }
            : S extends NullS<infer I>
              ? Infer<I> | null
              : never;

type Opts<T> = Omit<T, 'kind'>;

export const str = (o: Opts<StrS> = {}): StrS => ({ kind: 'string', ...o });
export const en = <const V extends readonly string[]>(values: V, o: Opts<Omit<EnumS<V>, 'values'>> = {}): EnumS<V> => ({
  kind: 'enum',
  values,
  ...o,
});
export const num = (o: Opts<NumS> = {}): NumS => ({ kind: 'number', ...o });
export const int = (o: Opts<IntS> = {}): IntS => ({ kind: 'integer', ...o });
export const bool = (o: Opts<BoolS> = {}): BoolS => ({ kind: 'boolean', ...o });
export const arr = <I extends Schema>(items: I, o: Opts<Omit<ArrS<I>, 'items'>> = {}): ArrS<I> => ({
  kind: 'array',
  items,
  ...o,
});
export const obj = <const P extends Record<string, Schema>>(props: P, o: Opts<Omit<ObjS<P>, 'props'>> = {}): ObjS<P> => ({
  kind: 'object',
  props,
  ...o,
});
export const nul = <I extends Schema>(inner: I, o: Opts<Omit<NullS<I>, 'inner'>> = {}): NullS<I> => ({
  kind: 'nullable',
  inner,
  ...o,
});

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: SchemaError[] };

/** 스키마에 맞으면 정의된 필드만 남긴 사본을 돌려준다. 정의되지 않은 필드는 버린다 (모델이 덧붙인 필드로 실패하지 않게). */
export function parse<S extends Schema>(schema: S, value: unknown): ParseResult<Infer<S>> {
  const errors: SchemaError[] = [];
  const out = walk(schema, value, '$', 'V-PARSE', errors);
  return errors.length === 0 ? { ok: true, value: out as Infer<S> } : { ok: false, errors };
}

function walk(s: Schema, v: unknown, path: string, inherited: string, errors: SchemaError[]): unknown {
  const code = s.code ?? inherited;
  const fail = (message: string): undefined => {
    errors.push({ code, path, message });
    return undefined;
  };
  switch (s.kind) {
    case 'string': {
      if (typeof v !== 'string') return fail('문자열이어야 함');
      if (s.minLength !== undefined && v.length < s.minLength) return fail(`최소 ${s.minLength}자`);
      if (s.maxLength !== undefined && v.length > s.maxLength) return fail(`최대 ${s.maxLength}자`);
      if (s.pattern && !s.pattern.test(v)) return fail(`형식 불일치 ${s.pattern}`);
      return v;
    }
    case 'enum':
      if (typeof v !== 'string' || !s.values.includes(v)) return fail(`허용 값: ${s.values.join(' | ')}`);
      return v;
    case 'number':
    case 'integer': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return fail('유한한 숫자여야 함');
      if (s.kind === 'integer' && !Number.isInteger(v)) return fail('정수여야 함');
      if (s.min !== undefined && v < s.min) return fail(`${s.min} 이상`);
      if (s.max !== undefined && v > s.max) return fail(`${s.max} 이하`);
      if (s.kind === 'number' && s.exclusiveMin !== undefined && v <= s.exclusiveMin) return fail(`${s.exclusiveMin} 초과`);
      return v;
    }
    case 'boolean':
      if (typeof v !== 'boolean') return fail('불리언이어야 함');
      return v;
    case 'array': {
      if (!Array.isArray(v)) return fail('배열이어야 함');
      if (s.minItems !== undefined && v.length < s.minItems) return fail(`최소 ${s.minItems}개`);
      if (s.maxItems !== undefined && v.length > s.maxItems) return fail(`최대 ${s.maxItems}개`);
      return v.map((item, i) => walk(s.items, item, `${path}[${i}]`, code, errors));
    }
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('객체여야 함');
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(s.props)) {
        if (!(key in src) || src[key] === undefined) {
          if ((child as Schema).default !== undefined) {
            out[key] = structuredClone((child as Schema).default);
            continue;
          }
          errors.push({ code: (child as Schema).code ?? code, path: `${path}.${key}`, message: '필수 필드 누락' });
          continue;
        }
        out[key] = walk(child as Schema, src[key], `${path}.${key}`, code, errors);
      }
      return out;
    }
    case 'nullable':
      return v === null ? null : walk(s.inner, v, path, code, errors);
  }
}

/**
 * claude --json-schema에 넘길 JSON 스키마. 호환성을 위해 기본 키워드만 쓰고,
 * 길이·범위 같은 제약은 설명문으로만 알린다 (최종 검증은 parse가 한다).
 */
export function toJsonSchema(s: Schema): Record<string, unknown> {
  const hints: string[] = [];
  if (s.description) hints.push(s.description);
  let out: Record<string, unknown>;
  switch (s.kind) {
    case 'string':
      if (s.maxLength !== undefined) hints.push(`max ${s.maxLength} chars`);
      out = { type: 'string' };
      break;
    case 'enum':
      out = { type: 'string', enum: [...s.values] };
      break;
    case 'number':
    case 'integer':
      if (s.min !== undefined) hints.push(`>= ${s.min}`);
      if (s.max !== undefined) hints.push(`<= ${s.max}`);
      if (s.kind === 'number' && s.exclusiveMin !== undefined) hints.push(`> ${s.exclusiveMin}`);
      out = { type: s.kind };
      break;
    case 'boolean':
      out = { type: 'boolean' };
      break;
    case 'array':
      if (s.minItems !== undefined) hints.push(`min ${s.minItems} items`);
      if (s.maxItems !== undefined) hints.push(`max ${s.maxItems} items`);
      out = { type: 'array', items: toJsonSchema(s.items) };
      break;
    case 'object': {
      const properties: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(s.props)) properties[k] = toJsonSchema(child as Schema);
      out = { type: 'object', properties, required: Object.keys(s.props), additionalProperties: false };
      break;
    }
    case 'nullable':
      out = { anyOf: [toJsonSchema(s.inner), { type: 'null' }] };
      break;
  }
  if (hints.length > 0) out.description = hints.join('; ');
  return out;
}

/** 모델이 문자열로 준 JSON을 읽는다. ```json 코드 블록으로 감싼 경우도 받는다. 실패하면 V-PARSE. */
export function parseJsonText(text: string): ParseResult<unknown> {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : trimmed) };
  } catch (e) {
    return { ok: false, errors: [{ code: 'V-PARSE', path: '$', message: `JSON 파싱 실패: ${(e as Error).message}` }] };
  }
}
