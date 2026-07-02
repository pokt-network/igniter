import { defaultPayloadConverter } from '@temporalio/common';
import type { temporal } from '@temporalio/proto';

type IPayload = temporal.api.common.v1.IPayload;

export const PAYLOAD_PREVIEW_LIMIT = 32 * 1024;

export type PayloadPreview = {
  text: string;
  truncated: boolean;
  decodeError: string | null;
};

export function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? `${value.toString()}n` : value;
}

export function safeJsonStringify(value: unknown, space = 2): string {
  try {
    const text = JSON.stringify(value, bigintSafeReplacer, space);
    return text === undefined ? 'undefined' : text;
  } catch (err) {
    return `[unserializable: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

function clamp(text: string): { text: string; truncated: boolean } {
  if (text.length <= PAYLOAD_PREVIEW_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, PAYLOAD_PREVIEW_LIMIT), truncated: true };
}

function rawPayloadText(payload: IPayload): string {
  const data = payload.data;
  if (!data || data.length === 0) return '<empty payload>';
  const buf = Buffer.from(data);
  const utf8 = buf.toString('utf8');
  // Printable-ish heuristic: no replacement chars and mostly visible chars.
  if (!utf8.includes('�')) return utf8;
  return `base64:${buf.toString('base64')}`;
}

export function previewPayloads(
  payloads: IPayload[] | null | undefined,
): PayloadPreview | null {
  if (!payloads || payloads.length === 0) return null;
  try {
    const values = payloads.map((p) => defaultPayloadConverter.fromPayload(p));
    const value = values.length === 1 ? values[0] : values;
    return { ...clamp(safeJsonStringify(value)), decodeError: null };
  } catch (err) {
    const raw = payloads.map(rawPayloadText).join('\n---\n');
    return {
      ...clamp(raw),
      decodeError: err instanceof Error ? err.message : String(err),
    };
  }
}
