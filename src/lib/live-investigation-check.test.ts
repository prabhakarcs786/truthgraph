import { describe, expect, it, vi } from "vitest";
import { investigateSample } from "./sample-investigation";
import { verifyLiveInvestigation } from "./live-investigation-check";
import { investigationSchema } from "./knowledge";

const request = { knowledgeBaseId: "tg-kb-framework-notes", question: "What runtime does Next.js 16 require?" };
const sample = investigateSample(request);

describe("generic live acceptance", () => {
  it("validates the selected question rather than a hardcoded scenario", async () => {
    const result = { ...sample, mode: "live", trace: [...sample.trace, { stage: "Entry retrieved", detail: "Example retrieved entry" }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(result));
    expect((await verifyLiveInvestigation("http://localhost:3000", "test", request, "answered", fetcher)).status).toBe("answered");
  });
  it("rejects sample payloads and unauthenticated live servers", async () => {
    const sampleServer = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(verifyLiveInvestigation("http://localhost:3000", "test", request, "answered", sampleServer)).rejects.toThrow("APP_MODE");
    const samplePayload = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json(sample));
    await expect(verifyLiveInvestigation("http://localhost:3000", "test", request, "answered", samplePayload)).rejects.toThrow("requested live");
  });
  it("rejects answer statements that are not supported by their claim", () => {
    expect(() => investigationSchema.parse({ ...sample, statements: [{ text: "An invented conclusion.", claimIds: [sample.statements[0].claimIds[0]] }] })).toThrow("cited applicable");
  });
});