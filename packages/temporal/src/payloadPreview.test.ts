import { defaultPayloadConverter } from '@temporalio/common';

import {
  PAYLOAD_PREVIEW_LIMIT,
  bigintSafeReplacer,
  previewPayloads,
  safeJsonStringify,
} from '@/payloadPreview';

describe('bigintSafeReplacer / safeJsonStringify', () => {
  it('serializes bigints as "<n>n" strings', () => {
    expect(JSON.stringify({ amount: 42n }, bigintSafeReplacer)).toBe('{"amount":"42n"}');
  });

  it('never throws on circular structures', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => safeJsonStringify(a)).not.toThrow();
    expect(safeJsonStringify(a)).toContain('[unserializable');
  });

  it('serializes undefined as the string "undefined"', () => {
    expect(safeJsonStringify(undefined)).toBe('undefined');
  });
});

describe('previewPayloads', () => {
  it('returns null for missing or empty payload lists', () => {
    expect(previewPayloads(null)).toBeNull();
    expect(previewPayloads(undefined)).toBeNull();
    expect(previewPayloads([])).toBeNull();
  });

  it('decodes a single JSON payload to pretty-printed text', () => {
    const payload = defaultPayloadConverter.toPayload({ txId: 7, memo: 'hi' });
    const preview = previewPayloads([payload]);
    expect(preview).not.toBeNull();
    expect(preview!.decodeError).toBeNull();
    expect(preview!.truncated).toBe(false);
    expect(JSON.parse(preview!.text)).toEqual({ txId: 7, memo: 'hi' });
    expect(preview!.text).toContain('\n'); // pretty-printed
  });

  it('renders multi-arg payloads as a JSON array', () => {
    const payloads = [
      defaultPayloadConverter.toPayload('first'),
      defaultPayloadConverter.toPayload({ second: true }),
    ];
    const preview = previewPayloads(payloads);
    expect(JSON.parse(preview!.text)).toEqual(['first', { second: true }]);
  });

  it('truncates beyond PAYLOAD_PREVIEW_LIMIT and flags it', () => {
    const payload = defaultPayloadConverter.toPayload('x'.repeat(PAYLOAD_PREVIEW_LIMIT + 100));
    const preview = previewPayloads([payload]);
    expect(preview!.truncated).toBe(true);
    expect(preview!.text.length).toBe(PAYLOAD_PREVIEW_LIMIT);
  });

  it('falls back to raw utf8 with decodeError on undecodable payloads', () => {
    const bogus = {
      metadata: { encoding: Buffer.from('unknown/enc') },
      data: Buffer.from('raw-bytes-here'),
    };
    const preview = previewPayloads([bogus]);
    expect(preview!.decodeError).not.toBeNull();
    expect(preview!.text).toContain('raw-bytes-here');
  });

  it('rejects control characters and falls back to base64', () => {
    const payload = {
      metadata: { encoding: Buffer.from('unknown/enc') },
      data: Buffer.from([0x01, 0x02, 0x03, 0x41]),
    };
    const preview = previewPayloads([payload]);
    expect(preview!.decodeError).not.toBeNull();
    expect(preview!.text).toMatch(/^base64:/);
  });
});
