import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lifecycleBaseId } from "./lifecycle-corpus";
import { realSampleCatalog } from "./sample-data";
import { investigateLocally } from "./sample-investigation";

const store = new Map<string, unknown>();
const catalog = realSampleCatalog({ includeLocalSamples: true });
const client = { getDocument: async (id: string) => store.get(id), createOrReplace: async (document: { _id: string }) => { store.set(document._id, document); return document; } };
vi.mock("server-only", () => ({}));
vi.mock("@sanity/client", () => ({ createClient: () => client }));
vi.mock("./catalog", () => ({ getKnowledgeCatalog: async () => ({ catalog, error: null }) }));
vi.mock("./import-management", () => ({ writer: () => client }));
import { withShowcaseCache } from "./showcase-cache";

const signal = new AbortController().signal;
const showcase = { knowledgeBaseId: lifecycleBaseId, question: "What is the end-of-life date for Node.js 16?" };
const compute = vi.fn(async () => ({ ...investigateLocally(showcase, catalog), mode: "live" as const }));
beforeEach(() => { store.clear(); compute.mockClear(); vi.stubEnv("SANITY_STUDIO_PROJECT_ID", "test"); vi.stubEnv("SANITY_WRITE_TOKEN", "test-only-value"); });
afterEach(() => vi.unstubAllEnvs());

describe("showcase result cache", () => {
  it("reuses a recorded run until records, applicable date windows, or the question change", async () => {
    await withShowcaseCache(showcase, signal, compute, "2026-10-01");
    const reused = await withShowcaseCache(showcase, signal, compute, "2026-10-02");
    expect(compute).toHaveBeenCalledOnce();
    expect(reused.trace[0].stage).toBe("Recorded live run");
    await withShowcaseCache(showcase, signal, compute, "2026-10-21");
    expect(compute).toHaveBeenCalledTimes(2);
    const edited = catalog.claims.findIndex((claim) => claim.knowledgeBaseId === lifecycleBaseId);
    catalog.claims[edited] = { ...catalog.claims[edited], statement: `${catalog.claims[edited].statement} Edited.` };
    await withShowcaseCache(showcase, signal, compute, "2026-10-21");
    expect(compute).toHaveBeenCalledTimes(3);
    await withShowcaseCache({ ...showcase, question: "A custom question about Node.js?" }, signal, compute, "2026-10-21");
    expect(compute).toHaveBeenCalledTimes(4);
    expect(store.size).toBe(1);
  });
  it("lets a read-only deployment reuse recorded runs without writing", async () => {
    await withShowcaseCache(showcase, signal, compute, "2026-10-01");
    vi.stubEnv("SANITY_WRITE_TOKEN", "");
    expect((await withShowcaseCache(showcase, signal, compute, "2026-10-01")).trace[0].stage).toBe("Recorded live run");
    store.clear();
    await withShowcaseCache(showcase, signal, compute, "2026-10-01");
    expect(compute).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(0);
  });
});
