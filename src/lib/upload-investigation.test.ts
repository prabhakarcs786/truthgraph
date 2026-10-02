import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImport } from "./knowledge-import";

const mocks = vi.hoisted(() => ({ generate: vi.fn(), model: vi.fn(), google: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: mocks.generate, Output: { object: (input: unknown) => input } }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => mocks.model }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: () => mocks.google }));
import { handleUploadInvestigation, investigateUpload } from "./upload-investigation";

async function fixture() {
  const prepared = await prepareImport({ title: "Repair club handbook", description: "Membership and opening hours supplied for this question.", publisher: "Document owner", kind: "real" }, [{ name: "handbook.txt", text: "The repair club opens at 07:30 on Saturdays. Annual membership costs 18 euros." }], "instant");
  return { prepared, request: { knowledgeBaseId: prepared.catalog.knowledgeBases[0]._id, question: "What does a year of membership cost?" }, consent: true };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_MODE", "live"); vi.stubEnv("OPENAI_API_KEY", "test-only-provider-key"); vi.stubEnv("LIVE_ACCESS_CODE", "test-only-app-code");
  mocks.model.mockReturnValue("test-model");
  mocks.generate.mockResolvedValue({ output: { intent: { summary: "Find the annual membership cost.", subjects: [], predicates: [], asOf: null, version: null, conditions: [] }, claimIds: ["tg-upload-instant-claim-0-0"] } });
});
afterEach(() => vi.unstubAllEnvs());

describe("immediate uploaded-document analysis", () => {
  it("returns supplied cited statements and identifies the direct-upload mode", async () => {
    const input = await fixture();
    const result = await investigateUpload(input, new AbortController().signal);
    expect(result.mode).toBe("upload");
    expect(result.answer).toBe(input.prepared.catalog.claims[0].statement);
    expect(result.answer).toContain("18 euros");
    expect(result.trace.some((step) => step.detail.includes("No Sanity or MCP call"))).toBe(true);
    expect(mocks.generate.mock.calls[0][0]).not.toHaveProperty("tools");
    expect(mocks.generate.mock.calls[0][0].prompt).not.toContain("test-only-provider-key");
  });
  it("does not send content to a provider without consent", async () => {
    await expect(investigateUpload({ ...await fixture(), consent: false }, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("does not treat user-declared authority as independent verification", async () => {
    const input = await fixture();
    input.prepared.catalog.sources[0].authority = "primary";
    const result = await investigateUpload(input, new AbortController().signal);
    expect(result.confidence).toBe("medium");
    expect(result.confidenceReason).toContain("not independently verified");
  });
  it("rejects a different corpus or modified file before inference", async () => {
    const input = await fixture();
    await expect(investigateUpload({ ...input, request: { ...input.request, knowledgeBaseId: "another-base" } }, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    input.prepared.uploads[0].text += " Modified source.";
    await expect(investigateUpload(input, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects fabricated or duplicated model citations", async () => {
    const input = await fixture();
    const generated = await mocks.generate();
    mocks.generate.mockResolvedValue({ output: { ...generated.output, claimIds: ["invented-claim"] } });
    await expect(investigateUpload(input, new AbortController().signal)).rejects.toMatchObject({ status: 502 });
    mocks.generate.mockResolvedValue({ output: { ...generated.output, claimIds: [input.prepared.catalog.claims[0]._id, input.prepared.catalog.claims[0]._id] } });
    await expect(investigateUpload(input, new AbortController().signal)).rejects.toMatchObject({ status: 502 });
  });
  it("admits insufficient evidence instead of substituting sample content", async () => {
    const generated = await mocks.generate();
    mocks.generate.mockResolvedValue({ output: { ...generated.output, claimIds: [] } });
    const result = await investigateUpload(await fixture(), new AbortController().signal);
    expect(result.status).toBe("insufficient"); expect(result.statements).toEqual([]);
  });
  it("requires live activation, an app code, and bounded JSON", async () => {
    const input = await fixture();
    const request = (body: unknown, code = "test-only-app-code") => new Request("http://localhost/api/investigate-upload", { method: "POST", headers: { "Content-Type": "application/json", "x-judge-code": code }, body: JSON.stringify(body) });
    expect((await handleUploadInvestigation(request(input, ""))).status).toBe(401);
    expect((await handleUploadInvestigation(request({ text: "x".repeat(1_048_576) }))).status).toBe(413);
    vi.stubEnv("APP_MODE", "demo");
    expect((await handleUploadInvestigation(request(input))).status).toBe(409);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("fails clearly when a provider key is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(investigateUpload(await fixture(), new AbortController().signal)).rejects.toMatchObject({ status: 503 });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("uses Gemini when it is the only configured provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-only-gemini-key");
    mocks.google.mockReturnValue("gemini-model");
    const result = await investigateUpload(await fixture(), new AbortController().signal);
    expect(result.status).toBe("answered");
    expect(mocks.google).toHaveBeenCalledWith("gemini-3.5-flash-lite");
    expect(mocks.generate.mock.calls[0][0].model).toBe("gemini-model");
    expect(mocks.model).not.toHaveBeenCalled();
  });
});