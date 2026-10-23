import { assertSignedTransaction } from "./signedTransaction";
import type { SignedTransaction } from "./models";

const tx = (overrides: Record<string, unknown>) =>
  ({ address: "pokt1owner", signedPayload: "abcd", unsignedPayload: "{}", signature: "sig", estimatedFee: 10, ...overrides }) as unknown as SignedTransaction;

describe("assertSignedTransaction", () => {
  it("returns a complete signature unchanged, fee included", () => {
    const signed = tx({});
    expect(assertSignedTransaction(signed)).toBe(signed);
  });

  it("does not invent a fee the wallet did not send", () => {
    expect(assertSignedTransaction(tx({ estimatedFee: undefined })).estimatedFee).toBeUndefined();
  });

  it.each(["", "  ", undefined, null, 123, { hex: "abcd" }])("rejects signedPayload %p (tx 519 was '')", (signedPayload) => {
    expect(() => assertSignedTransaction(tx({ signedPayload }))).toThrow("no signed transaction");
  });

  it.each(["", undefined, { body: {} }])("rejects unsignedPayload %p", (unsignedPayload) => {
    expect(() => assertSignedTransaction(tx({ unsignedPayload }))).toThrow("no transaction body");
  });
});
