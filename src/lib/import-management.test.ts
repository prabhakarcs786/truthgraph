import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImport } from "./knowledge-import";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), createIfNotExists: vi.fn(), transaction: vi.fn(), commit: vi.fn(), getDocument: vi.fn(), patch: vi.fn(), revision: vi.fn(), set: vi.fn(), connect: vi.fn(), tools: vi.fn(), initial: vi.fn(), close: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@sanity/client", () => ({ createClient: () => ({ fetch: mocks.fetch, createIfNotExists: mocks.createIfNotExists, transaction: mocks.transaction, getDocument: mocks.getDocument, patch: mocks.patch }) }));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocks.connect }));
import { authorizeManagement, mapKnowledgeBase, saveKnowledgeImport } from "./import-management";
import { GET, POST } from "../app/api/knowledge-bases/route";
import { PATCH } from "../app/api/knowledge-bases/[id]/route";
import { GET as evidence } from "../app/api/evidence/route";

const metadata = { title: "Uploaded handbook", description: "Real uploaded handbook excerpts for membership questions.", publisher: "Handbook owner", kind: "real" as const };
const managementCode = "a-separate-long-admin-code-value";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_MODE", "live");
  vi.stubEnv("KNOWLEDGE_ADMIN_CODE", managementCode);
  for (const name of ["SANITY_STUDIO_PROJECT_ID", "SANITY_WRITE_TOKEN", "SANITY_ORGANIZATION_TOKEN", "OPENAI_API_KEY", "LIVE_ACCESS_CODE"]) vi.stubEnv(name, "test-only-value");
  vi.stubEnv("SANITY_CONTEXT_MCP_URL", "https://api.sanity.io/v1/context/organizations/test/mcp/truthgraph");
  mocks.fetch.mockImplementation((query: string) => Promise.resolve(query.includes("tg-runtime-budget") ? { revision: "budget-revision", documents: 1 } : { knowledgeBases: [], sources: [], claims: [] }));
  const transaction = { create: mocks.create, commit: mocks.commit, patch: vi.fn() };
  transaction.patch.mockReturnValue(transaction);
  mocks.transaction.mockReturnValue(transaction); mocks.create.mockReturnValue(transaction); mocks.commit.mockResolvedValue({});
  mocks.patch.mockReturnValue({ ifRevisionId: mocks.revision }); mocks.revision.mockReturnValue({ set: mocks.set }); mocks.set.mockReturnValue({ commit: mocks.commit });
  mocks.connect.mockResolvedValue({ tools: mocks.tools, close: mocks.close }); mocks.tools.mockResolvedValue({ initial_context: { execute: mocks.initial }, knowledge_base_read: { execute: vi.fn() } });
  mocks.initial.mockResolvedValue({ content: [{ text: "Knowledge base id: kbverified" }] }); mocks.close.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("protected Sanity knowledge imports", () => {
  it("does not grant write access to a judge code", () => {
    const request = new Request("http://localhost/api/knowledge-bases", { headers: { "x-judge-code": "judge-code" } });
    const config = { KNOWLEDGE_ADMIN_CODE: "a-separate-long-admin-code-value", LIVE_ACCESS_CODE: "judge-code" };
    expect(() => authorizeManagement(request, config)).toThrow("management code");
    expect(() => authorizeManagement(request, { ...config, KNOWLEDGE_ADMIN_CODE: config.LIVE_ACCESS_CODE })).toThrow("separate");
    expect(() => authorizeManagement(new Request(request.url, { headers: { "x-knowledge-admin-code": config.KNOWLEDGE_ADMIN_CODE } }), config)).not.toThrow();
  });
  it("creates the whole corpus atomically and preserves original text", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    const result = await saveKnowledgeImport(prepared, new AbortController().signal);
    expect(result.state).toBe("awaiting-index");
    expect(result.knowledgeBase.mcpId).toBeNull();
    expect(mocks.create).toHaveBeenCalledTimes(3);
    expect(mocks.create.mock.calls.find(([document]) => document._type === "tgSource")?.[0].uploadedText).toContain("seven days");
    expect(mocks.commit).toHaveBeenCalledWith({ visibility: "sync", signal: expect.any(AbortSignal) });
  });
  it("rejects duplicate imports without overwriting existing records", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    mocks.fetch.mockResolvedValue(prepared.catalog);
    await expect(saveKnowledgeImport(prepared, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("does not accept a pre-mapped unverified upload", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    prepared.catalog.knowledgeBases[0].mcpId = "kbunverified";
    await expect(saveKnowledgeImport(prepared, new AbortController().signal)).rejects.toMatchObject({ status: 400 });
  });
  it("rejects a mismatched source fingerprint before accessing Sanity", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    prepared.uploads[0].text += " Additional text changes the fingerprint.";
    await expect(saveKnowledgeImport(prepared, new AbortController().signal)).rejects.toMatchObject({ status: 400, code: "invalid-import" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("verifies the MCP outline and revision before mapping", async () => {
    const base = { _id: "tg-upload-test-base", _type: "tgKnowledgeBase", _rev: "before", title: metadata.title, description: metadata.description, kind: "real", mcpId: null, suggestedQuestions: [] };
    mocks.getDocument.mockResolvedValue(base); mocks.commit.mockResolvedValue({ ...base, mcpId: "kbverified" });
    const result = await mapKnowledgeBase(base._id, "kbverified", null, new AbortController().signal);
    expect(result.state).toBe("outline-verified");
    expect(mocks.revision).toHaveBeenCalledWith("before");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("does not save inaccessible or stale mappings", async () => {
    mocks.getDocument.mockResolvedValue({ _id: "tg-test", _type: "tgKnowledgeBase", _rev: "before", mcpId: "kbprevious" });
    await expect(mapKnowledgeBase("tg-test", "kbverified", null, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
    mocks.initial.mockResolvedValue({ isError: true });
    await expect(mapKnowledgeBase("tg-test", "kbverified", "kbprevious", new AbortController().signal)).rejects.toThrow("tool error");
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});

describe("knowledge management HTTP contract", () => {
  function request(method: "POST" | "PATCH", body: unknown, headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/knowledge-bases", { method, headers: { "Content-Type": "application/json", "x-knowledge-admin-code": managementCode, ...headers }, body: JSON.stringify(body) });
  }
  it("lists only public knowledge-base metadata", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    mocks.fetch.mockResolvedValue(prepared.catalog);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ knowledgeBases: prepared.catalog.knowledgeBases, budget: expect.objectContaining({ limit: 150 }) });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects judge-only writes and cross-origin management requests", async () => {
    const headers = { "x-knowledge-admin-code": "", "x-judge-code": "test-only-value" };
    expect((await POST(request("POST", {}, headers))).status).toBe(401);
    expect((await PATCH(request("PATCH", {}, headers), { params: Promise.resolve({ id: "tg-test" }) })).status).toBe(401);
    expect((await POST(request("POST", {}, { origin: "https://other.example" }))).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("exposes only showcase evidence without a code, not arbitrary shared uploads", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "private-test");
    mocks.fetch.mockResolvedValue(prepared.catalog);
    const url = `http://localhost/api/evidence?knowledgeBaseId=${prepared.catalog.knowledgeBases[0]._id}`;
    expect((await evidence(new Request(url))).status).toBe(401);
    expect((await evidence(new Request(url, { headers: { "x-judge-code": "test-only-value" } }))).status).toBe(200);
    prepared.catalog.knowledgeBases[0].showcase = [{ title: "Published example", question: "How long can members borrow tools?", asOf: null, lesson: "Reviewed, intentionally public evidence." }];
    expect((await evidence(new Request(url))).status).toBe(200);
  });
  it("returns awaiting-index after an authorized import, never a fabricated ready state", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    const response = await POST(request("POST", prepared));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ state: "awaiting-index", knowledgeBase: { mcpId: null } });
  });
  it("validates bodies and bounds the streamed import payload", async () => {
    expect((await POST(request("POST", {}))).status).toBe(400);
    expect((await POST(request("POST", {}, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect((await POST(request("POST", { text: "x".repeat(1_048_576) }))).status).toBe(413);
    const response = await PATCH(request("PATCH", { mcpId: "https://other.example", expectedMcpId: null }), { params: Promise.resolve({ id: "tg-test" }) });
    expect(response.status).toBe(400);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("does not accept server uploads or mappings in local mode", async () => {
    vi.stubEnv("APP_MODE", "demo");
    expect((await POST(request("POST", {}))).status).toBe(409);
    expect((await PATCH(request("PATCH", {}), { params: Promise.resolve({ id: "tg-test" }) })).status).toBe(409);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("returns safe import errors without provider details", async () => {
    const prepared = await prepareImport(metadata, [{ name: "handbook.txt", text: "Workshop members can borrow tools for seven days." }], "test");
    mocks.fetch.mockRejectedValue(new Error("provider-secret-must-not-leak"));
    const response = await POST(request("POST", prepared));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "import-unconfirmed" });
  });
});