import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleCatalog } from "./sample-data";
import { selectSampleEvidence } from "./sample-investigation";

const mocks = vi.hoisted(() => ({ create: vi.fn(), tools: vi.fn(), close: vi.fn(), generate: vi.fn(), catalog: vi.fn(), read: vi.fn(), initial: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocks.create }));
vi.mock("./catalog", () => ({ getKnowledgeCatalog: mocks.catalog }));
vi.mock("ai", async (importOriginal) => ({ ...await importOriginal<typeof import("ai")>(), generateText: mocks.generate }));
import { investigateWithContext } from "./investigator";

const request = { knowledgeBaseId: "tg-kb-framework-notes", question: "What runtime does Next.js 16 require?" };
const corpus = { ...sampleCatalog, knowledgeBases: sampleCatalog.knowledgeBases.map((base) => ({ ...base, mcpId: "kbtest" })) };
const evidence = corpus.claims.map((claim) => `${claim._id}\n${claim.statement}\n${corpus.sources.find((source) => source._id === claim.sourceId)?.url}`).join("\n");

beforeEach(() => {
  vi.resetAllMocks();
  for (const name of ["SANITY_ORGANIZATION_TOKEN", "OPENAI_API_KEY", "SANITY_STUDIO_PROJECT_ID", "LIVE_ACCESS_CODE"]) vi.stubEnv(name, "test-only-value");
  vi.stubEnv("SANITY_CONTEXT_MCP_URL", "https://api.sanity.io/v1/context/organizations/test-org/mcp/truthgraph");
  mocks.catalog.mockResolvedValue({ catalog: corpus, error: null });
  mocks.create.mockResolvedValue({ tools: mocks.tools, close: mocks.close });
  mocks.tools.mockResolvedValue({ initial_context: { execute: mocks.initial }, knowledge_base_read: { execute: mocks.read } });
  mocks.close.mockResolvedValue(undefined);
  mocks.initial.mockResolvedValue({ content: [{ type: "text", text: "Knowledge base id: kbtest\nframework/runtime" }] });
  mocks.read.mockResolvedValue({ content: [{ type: "text", text: evidence }] });
  mocks.generate.mockImplementation(async (options) => {
    await options.tools.initial_context.execute({}, { toolCallId: "outline", messages: [] });
    await options.tools.knowledge_base_read.execute({ knowledgeBase: "kbtest", paths: ["framework/runtime"] }, { toolCallId: "test", messages: [] });
    return { output: selectSampleEvidence(request) };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("question-first MCP investigator", () => {
  it("scopes the MCP endpoint and evaluates actual retrieved claim text", async () => {
    const result = await investigateWithContext(request, new AbortController().signal);
    expect(result.mode).toBe("live");
    expect(result.answer).toContain("20.9.0");
    expect(new URL(mocks.create.mock.calls[0][0].transport.url).searchParams.get("knowledgeBases")).toBe("kbtest");
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.generate.mock.calls[0][0].prepareStep({ stepNumber: 0 }).toolChoice.toolName).toBe("initial_context");
  });
  it("blocks attempts to retrieve a different knowledge base", async () => {
    mocks.generate.mockImplementation(async (options) => {
      await options.tools.initial_context.execute({}, { toolCallId: "outline", messages: [] });
      return options.tools.knowledge_base_read.execute({ knowledgeBase: "kbother", paths: ["private/records"] }, { toolCallId: "test", messages: [] });
    });
    await expect(investigateWithContext(request, new AbortController().signal)).rejects.toThrow("Cross-knowledge-base");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("never accepts claims that were not retrieved", async () => {
    mocks.generate.mockImplementation(async (options) => {
      await options.tools.initial_context.execute({}, { toolCallId: "outline", messages: [] });
      return { output: selectSampleEvidence(request) };
    });
    await expect(investigateWithContext(request, new AbortController().signal)).rejects.toThrow("not found in a retrieved Knowledge Base entry");
  });
  it("returns insufficient evidence instead of manufacturing an answer", async () => {
    const empty = { ...selectSampleEvidence(request), claimIds: [] };
    mocks.generate.mockImplementation(async (options) => {
      await options.tools.initial_context.execute({}, { toolCallId: "outline", messages: [] });
      return { output: empty };
    });
    expect((await investigateWithContext(request, new AbortController().signal)).status).toBe("insufficient");
  });
  it("rejects an unmapped knowledge base before calling a model", async () => {
    mocks.catalog.mockResolvedValue({ catalog: sampleCatalog, error: null });
    await expect(investigateWithContext(request, new AbortController().signal)).rejects.toThrow("configured Sanity");
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("always closes a connection after provider failure", async () => {
    mocks.generate.mockRejectedValue(new Error("provider failed"));
    await expect(investigateWithContext(request, new AbortController().signal)).rejects.toThrow("provider failed");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("does not present a failed outline call as insufficient evidence", async () => {
    mocks.initial.mockResolvedValue({ isError: true, content: [{ text: "Outline unavailable" }] });
    await expect(investigateWithContext(request, new AbortController().signal)).rejects.toThrow("tool error");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects an answer that skipped the outline", async () => {
    mocks.generate.mockResolvedValue({ output: { ...selectSampleEvidence(request), claimIds: [] } });
    await expect(investigateWithContext(request, new AbortController().signal)).rejects.toThrow("No verified");
  });
});