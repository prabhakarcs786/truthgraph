import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { offerInvestigationShare, verifyInvestigationShare } from "./investigation-sharing";
import { investigateSample } from "./sample-investigation";
import { type Investigation } from "./knowledge";

const secret = "test-only-secret-at-least-24-characters";
const now = Date.parse("2026-10-01T12:00:00Z");
const result: Investigation = { ...investigateSample({ knowledgeBaseId: "tg-kb-framework-notes", question: "What runtime does Next.js 16 require?" }), mode: "live" };

describe("server-issued share receipts", () => {
  it("signs a complete snapshot, but does not publish sample or direct-upload results", () => {
    const offered = offerInvestigationShare(result, secret, now, true);
    expect(offered.shareReceipt).toBeDefined();
    expect(verifyInvestigationShare(offered, secret, now).result).toEqual(result);
    expect(offerInvestigationShare(result, secret, now, false).shareReceipt).toBeUndefined();
    expect(offerInvestigationShare({ ...result, mode: "sample" }, secret, now, true).shareReceipt).toBeUndefined();
    expect(offerInvestigationShare({ ...result, mode: "upload" }, secret, now, true).shareReceipt).toBeUndefined();
  });
  it("rejects edited answers, questions, IDs, and expired or wrong-key receipts", () => {
    const offered = offerInvestigationShare(result, secret, now, true);
    expect(() => verifyInvestigationShare({ ...offered, question: "A fabricated question" }, secret, now)).toThrow("unmodified");
    expect(() => verifyInvestigationShare({ ...offered, answer: "A fabricated answer" }, secret, now)).toThrow("unmodified");
    expect(() => verifyInvestigationShare({ ...offered, shareReceipt: { ...offered.shareReceipt, id: "5f2d4d3a-b18a-4b68-830e-728955996e4b" } }, secret, now)).toThrow("unmodified");
    expect(() => verifyInvestigationShare(offered, "different-long-secret-test-value", now)).toThrow("unmodified");
    expect(() => verifyInvestigationShare(offered, secret, now + 3_600_000)).toThrow("expired");
    expect(() => verifyInvestigationShare(result, secret, now)).toThrow("unmodified");
  });
});