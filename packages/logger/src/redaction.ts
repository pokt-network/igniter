import {
  getConsoleSink,
  type LogLevel,
  type LogRecord,
  type Sink,
  type TextFormatter,
} from '@logtape/logtape'
import { getPrettyFormatter } from '@logtape/pretty'
import {
  redactByField,
  redactByPattern,
  JWT_PATTERN,
  type RedactionPattern,
  type RedactionPatterns,
} from '@logtape/redaction'

const REDACTED = '[REDACTED]'

/**
 * Secret KEY names redacted at any depth (sink-level via redactByField, which is
 * recursive over nested objects/arrays — verified against @logtape/redaction's
 * `redactProperties`; and in our hand-built `redactObject`). All patterns are
 * anchored (`^...$`) so they match exact field names only.
 *
 * `credentials.signature` IS covered globally here: `/^signature$/i` matches the
 * `signature` field at any depth (an auth signature is a secret everywhere).
 *
 * `publicKey` is intentionally ABSENT (locked §0: technically public, NOT globally
 * redacted). It is redacted ONLY under `credentials.*` (handled contextually in
 * `redactObject` below) and truncated at the auth site — never via this global list.
 * The `[_]?` between words tolerates BOTH camelCase and snake_case field names
 * (`privateKey` AND `private_key`) — our own Temporal bridge normalizes meta to
 * snake_case, and env/config-derived secrets arrive snake_cased. `public_key`
 * stays un-redacted for the same reason `publicKey` does (locked §0).
 *
 * DO NOT `...DEFAULT_REDACT_FIELDS` here: that array is
 * `[/pass.../, /secret/i, /token/i, /key/i, /credential/i, /auth/i, /signature/i,
 * /sensitive/i, /private/i, /ssn/i, /email/i, /phone/i, /address/i]` —
 * `/key/i` matches `publicKey` (violates the locked rule) and `/address/i`,
 * `/email/i`, `/phone/i` would scrub non-secret debug fields (`ownerAddress`,
 * `delegatorRewardsAddress`, etc.). The field-list tests lock both out.
 */
export const SECRET_FIELD_PATTERNS: (string | RegExp)[] = [
  /^private[_]?key$/i,
  /^signer[_]?private[_]?key$/i,
  /^mnemonic$/i,
  /^seed[_]?phrase$/i,
  /^seed$/i,
  /^secret[_]?key$/i,
  /^password$/i,
  /^pass$/i, // smtp.pass
  /^token$/i,
  /^access[_]?token$/i,
  /^refresh[_]?token$/i,
  /^session[_]?token$/i,
  /^api[_]?key$/i,
  /^secret$/i,
  /^authorization$/i,
  /^cookie$/i,
  /^set[-_]?cookie$/i,
  /^signature$/i, // covers credentials.signature globally
]

/**
 * Free-text backstop for `key=value` / `key: value` secrets interpolated into
 * error messages or template strings (e.g. `` `login failed: password=${pw}` ``)
 * that never pass through the field-based redactors because they're not a
 * distinct object property. LOW false-positive risk by design: it only fires
 * on the literal keywords below, not a generic "looks secret-ish" heuristic
 * (no 64-hex — would redact tx hashes; no generic base64).
 *
 * Capture groups preserve the matched key + separator so the output reads
 * `password=[REDACTED]` rather than swallowing the key name too.
 */
const PASSWORD_VALUE_PATTERN: RedactionPattern = {
  pattern: /(password|passwd|pwd|secret)(\s*[=:]\s*)\S+/gi,
  replacement: '$1$2' + REDACTED,
}

/** Free-text backstop for `Authorization: Bearer <token>` interpolated into logs. */
const BEARER_TOKEN_PATTERN: RedactionPattern = {
  pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  replacement: 'Bearer ' + REDACTED,
}

/**
 * Value-shaped secrets scrubbed from rendered output as a backstop.
 *
 * NOTE (verified against installed @logtape/redaction@2.2.1, deviates from the
 * task brief's `RegExp[]` annotation): `JWT_PATTERN` is a `RedactionPattern`
 * object (`{ pattern: RegExp; replacement: ... }`), not a bare `RegExp`, and
 * `redactByPattern`'s second parameter is typed `RedactionPatterns`
 * (`readonly RedactionPattern[]`). `RegExp[]` would not typecheck here.
 */
export const SECRET_VALUE_PATTERNS: RedactionPatterns = [
  JWT_PATTERN,
  PASSWORD_VALUE_PATTERN,
  BEARER_TOKEN_PATTERN,
]

// DEFERRED (spec §7 optional, intentionally NOT wired in #219):
// `@logtape/redaction`'s `createHmacPseudonymizer` + the async `redactByFieldAsync`
// (Web Crypto HMAC) give stable correlatable pseudonyms instead of blackouts. They
// require confirming async redaction composes with `nonBlocking` sink buffering
// (spec §12) — out of scope for the foundation. Reach for them in a later pass if a
// pseudonymized-address use case appears.

function isSecretKey(key: string): boolean {
  return SECRET_FIELD_PATTERNS.some((p) => (typeof p === 'string' ? p === key : p.test(key)))
}

function redactCredentials(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    // Inside credentials.*, publicKey + signature are secrets.
    if (/^publicKey$/i.test(k) || /^signature$/i.test(k) || isSecretKey(k)) {
      out[k] = REDACTED
    } else {
      out[k] = redactObject(v, depth + 1, seen)
    }
  }
  return out
}

/**
 * Hand-built deep redactor (no library equivalent). Shares the §7 field config.
 * Used for explicit deep payloads and the edge/client write paths.
 *
 * Cycle guard (F2 hardening): `seen` is a `WeakSet` of every object/array
 * already entered on the CURRENT recursion. Without it, a self-referential
 * object (e.g. `a.nested.self = a`) recurses until the depth cap (20) kicks
 * in and then returns the tail of the cycle un-redacted as-is — which, being
 * part of the cycle, IS (structurally reachable back to) the original
 * un-redacted object. The guard catches the re-entry immediately, well
 * before depth 20, and swaps in the literal string `'[circular]'` instead.
 * The depth cap stays as a backstop for pathologically deep (non-cyclic)
 * structures.
 */
export function redactObject<T>(obj: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (depth > 20 || obj == null || typeof obj !== 'object') return obj
  if (seen.has(obj as object)) return '[circular]' as unknown as T
  seen.add(obj as object)
  if (Array.isArray(obj)) {
    return obj.map((v) => redactObject(v, depth + 1, seen)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = REDACTED
    } else if (/^credentials$/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactCredentials(v as Record<string, unknown>, depth, seen)
    } else {
      out[k] = redactObject(v, depth + 1, seen)
    }
  }
  return out as T
}

/**
 * Numeric severity codes (LOCKED §0) for the prod NDJSON path. LogTape's built-in
 * `jsonLinesFormatter` emits an UPPERCASE STRING level and offers no level-format
 * option, so we render the same NDJSON shape with a numeric `level` instead.
 */
const LEVEL_NUMBER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warning: 40,
  error: 50,
  fatal: 60,
}

/**
 * Serialize values that bare `JSON.stringify` mishandles, SCOPED to the logging
 * paths only (NO global `BigInt.prototype.toJSON` patch — that silently changed
 * Temporal payload boundary semantics: bigint would cross as a string instead of
 * throwing loud, which activities/index.ts relies on).
 *   - `Error` → a plain `{ name, message, stack }` object.
 *   - `bigint` → its decimal string (LogTape's JSON formatters throw on bigint).
 */
function prodJsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  return value
}

/**
 * Cycle- AND bigint-safe `JSON.stringify` for the prod NDJSON path (F4/F12): a
 * cyclic property (or a bigint the replacer somehow misses) would otherwise make
 * `JSON.stringify` THROW and the whole record silently vanish. This wraps the
 * value replacer with a per-call `WeakSet` circular guard so a record is ALWAYS
 * emitted — cycles render as the literal `'[circular]'`.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (key, val) => {
    const replaced = prodJsonReplacer(key, val)
    if (replaced !== null && typeof replaced === 'object') {
      if (seen.has(replaced as object)) return '[circular]'
      seen.add(replaced as object)
    }
    return replaced
  })
}

/** Render LogTape's message-parts array ([text, value, text, ...]) to a string. */
function renderMessage(message: readonly unknown[]): string {
  let out = ''
  for (let i = 0; i < message.length; i++) {
    out += i % 2 === 0 ? String(message[i]) : safeStringify(message[i])
  }
  return out
}

/**
 * Prod NDJSON formatter with a NUMERIC level (Loki/collector parity). Mirrors the
 * built-in jsonLinesFormatter shape ({ @timestamp, level, message, logger,
 * properties }) but `level` is a number. Exported for unit testing.
 */
export const jsonLinesNumericFormatter: TextFormatter = (record: LogRecord): string =>
  safeStringify({
    '@timestamp': new Date(record.timestamp).toISOString(),
    level: LEVEL_NUMBER[record.level],
    message: renderMessage(record.message),
    logger: record.category.join('.'),
    properties: record.properties,
  }) + '\n'

/**
 * Console sink with both redaction layers wired:
 *   1. redactByField wraps the SINK (deletes secret props before formatting).
 *      Array form => default action = "delete" (verified against @logtape/redaction:
 *      the matched field is omitted from the copy; there is NO `{ remove: true }`
 *      argument — `redactByField(sink, options)` takes only two args, where options
 *      is either a FieldPatterns array or `{ fieldPatterns, action }`).
 *   2. redactByPattern wraps the FORMATTER (scrubs value-shaped secrets in rendered
 *      text as a backstop).
 */
// Dev pretty formatter renders structured properties inline (properties: true) so
// payload-carrying debug lines (e.g. drizzle's query/params) are visible without
// switching to prod NDJSON. Depth-capped to keep multi-line output sane.
// Base/resource fields (service.*, env, runtime) are constant per process — they
// matter for the prod collector but are pure repetition on a local terminal, so
// dev rendering drops them.
const DEV_HIDDEN_PROPS = ['service.name', 'service.version', 'env', 'runtime'] as const
const basePrettyFormatter = getPrettyFormatter({
  properties: true,
  inspectOptions: { depth: 4 },
}) as TextFormatter
const devPrettyFormatter: TextFormatter = (record) => {
  const properties = { ...record.properties }
  for (const key of DEV_HIDDEN_PROPS) delete properties[key]
  return basePrettyFormatter({ ...record, properties })
}

export function getRedactedConsoleSink(useJson: boolean): Sink {
  const baseFormatter: TextFormatter = useJson ? jsonLinesNumericFormatter : devPrettyFormatter
  const safeFormatter = redactByPattern(baseFormatter, SECRET_VALUE_PATTERNS)
  return redactByField(getConsoleSink({ formatter: safeFormatter }), SECRET_FIELD_PATTERNS)
}

/* ---- Promoted provider-workflows redactors (structurally typed: NO @igniter/pocket
   import, to avoid a pocket<->logger dependency cycle). ---- */

export function redactSupplierServiceConfig<
  C extends { serviceId: unknown; endpoints: unknown[]; revShare: unknown[] },
>(config: C): { serviceId: unknown; endpoints: unknown[]; revShare: unknown[] } {
  return {
    serviceId: config.serviceId,
    endpoints: [...config.endpoints],
    revShare: [...config.revShare],
  }
}

export function redactSupplierServiceConfigs<
  C extends { serviceId: unknown; endpoints: unknown[]; revShare: unknown[] },
>(configs: C[]) {
  return configs.map(redactSupplierServiceConfig)
}

export function redactStakeSupplierParams<
  P extends { signerPrivateKey?: unknown; services: Array<{ serviceId: unknown; endpoints: unknown[]; revShare: unknown[] }> },
>(params: P): Omit<P, 'signerPrivateKey' | 'services'> & {
  services: Array<{ serviceId: unknown; endpoints: unknown[]; revShare: unknown[] }>
} {
  const { signerPrivateKey: _drop, services, ...rest } = params
  return {
    ...(rest as Omit<P, 'signerPrivateKey' | 'services'>),
    services: redactSupplierServiceConfigs(services),
  }
}
