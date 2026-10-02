import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realSampleCatalog } from "./sample-data";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), transaction: vi.fn(), patch: vi.fn(), remove: vi.fn(), commit: vi.fn(), revision: vi.fn(), set: vi.fn(), append: vi.fn(), unset: vi.fn(), setIfMissing: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./import-management", async (original) => ({ ...await original<typeof import("./import-management")>(), writer: () => ({ fetch: mocks.fetch, transaction: mocks.transaction }) }));
import { applyCuration, curationOverview } from "./curation-store";
import { GET, POST } from "../app/api/admin/route";

const baseId = "tg-kb-framework-notes";
const context = { knowledgeBaseId: baseId, expectedRevision: "base-revision" };
const signal = new AbortController().signal;
const managementCode = "a-separate-long-admin-code-value";
const catalog = realSampleCatalog({ includeLocalSamples: true });
const state = {
  catalog: { ...catalog, knowledgeBases: catalog.knowledgeBases.map((base) => ({ ...base, mcpId: "kbtest" })) },
  revision: "base-revision",
  records: catalog.claims.map((claim) => ({ _id: claim._id, _rev: "claim-revision", relations: claim.relations.map((relation, index) => ({ ...relation, _key: `relation-${index}` })) })),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_MODE", "live");
  vi.stubEnv("KNOWLEDGE_ADMIN_CODE", managementCode);
  mocks.fetch.mockResolvedValue(state);
  const transaction = { patch: mocks.patch, delete: mocks.remove, commit: mocks.commit };
  const patch = { ifRevisionId: mocks.revision, set: mocks.set, append: mocks.append, unset: mocks.unset, setIfMissing: mocks.setIfMissing };
  Object.values(patch).forEach((method) => method.mockReturnValue(patch));
  mocks.transaction.mockReturnValue(transaction);
  mocks.patch.mockImplementation((_id, modify) => { modify(patch); return transaction; });
  mocks.remove.mockReturnValue(transaction);
  mocks.commit.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("revision-guarded curation", () => {
  it("reports a consistent overview and an honest unreviewed index state", async () => {
    const result = await curationOverview(baseId, signal);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ revision: "base-revision", indexState: "review-required" });
    expect(result.conflicts).toHaveLength(1);
    expect(result.claims.every((claim) => claim.revision === "claim-revision")).toBe(true);
  });
  it("atomically saves a decision, guards the base and claim revisions, and marks the index dirty", async () => {
    await applyCuration({ ...context, action: "add-relation", fromId: "tg-claim-node-annual-lts", toId: "tg-claim-node-odd-lts-wg", kind: "supersedes", reason: "The revised annual policy explicitly starts at Node.js 27." }, signal);
    expect(mocks.revision.mock.calls).toEqual([["base-revision"], ["claim-revision"]]);
    expect(mocks.set).toHaveBeenCalledWith({ contentChangedAt: expect.any(String) });
    expect(mocks.append).toHaveBeenCalledWith("relations", [expect.objectContaining({ target: { _type: "reference", _ref: "tg-claim-node-odd-lts-wg" } })]);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });
  it("rejects a stale screen, different subjects, and a commit race", async () => {
    await expect(applyCuration({ ...context, expectedRevision: "old", action: "delete-claim", claimId: "tg-claim-lint-16", revision: "claim-revision" }, signal)).rejects.toMatchObject({ status: 409 });
    await expect(applyCuration({ ...context, action: "add-relation", fromId: "tg-claim-lint-16", toId: "tg-claim-node-odd-lts-wg", kind: "supersedes", reason: "Not the same subject or property." }, signal)).rejects.toMatchObject({ status: 409 });
    expect(mocks.commit).not.toHaveBeenCalled();
    mocks.commit.mockRejectedValue({ statusCode: 409 });
    await expect(applyCuration({ ...context, action: "remove-relation", claimId: "tg-claim-node16-eol-revised", key: "relation-0" }, signal)).rejects.toMatchObject({ status: 409, code: "curation-conflict" });
  });
  it("refuses to delete referenced or concurrently changed claims", async () => {
    await expect(applyCuration({ ...context, action: "delete-claim", claimId: "tg-claim-node16-eol-planned", revision: "claim-revision" }, signal)).rejects.toMatchObject({ code: "claim-referenced" });
    await expect(applyCuration({ ...context, action: "delete-claim", claimId: "tg-claim-lint-16", revision: "old" }, signal)).rejects.toMatchObject({ code: "curation-conflict" });
    expect(mocks.commit).not.toHaveBeenCalled();
    await applyCuration({ ...context, action: "delete-claim", claimId: "tg-claim-lint-16", revision: "claim-revision" }, signal);
    expect(mocks.remove).toHaveBeenCalledWith("tg-claim-lint-16");
  });
  it("records an operator-confirmed rebuild without claiming automated verification", async () => {
    const result = await applyCuration({ ...context, action: "confirm-index", confirmed: true }, signal);
    expect(mocks.set).toHaveBeenCalledWith({ indexReviewedAt: expect.any(String) });
    expect(result.message).toContain("not an automatic freshness check");
  });
  it("requires admin authorization and bounded, revisioned actions", async () => {
    const makeRequest = (body: object, headers: Record<string, string>) => new Request("http://localhost/api/admin", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await GET(new Request(`http://localhost/api/admin?knowledgeBaseId=${baseId}`))).status).toBe(401);
    expect((await POST(makeRequest({}, { "x-judge-code": managementCode }))).status).toBe(401);
    expect((await POST(makeRequest({}, { "x-knowledge-admin-code": managementCode, Origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(makeRequest({ action: "delete-claim", knowledgeBaseId: baseId, claimId: "tg-claim-lint-16" }, { "x-knowledge-admin-code": managementCode }))).status).toBe(400);
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});