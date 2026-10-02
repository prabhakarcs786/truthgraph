import { describe, expect, it } from "vitest";
import { appendImport, loadImports, removeImport } from "./import-storage";
import { prepareImport } from "./knowledge-import";
import { sampleCatalog } from "./sample-data";
import { investigateLocally } from "./sample-investigation";

const metadata = { title: "Bike workshop", description: "Original uploaded workshop membership information.", publisher: "Workshop owner", kind: "real" as const };
const files = [{ name: "membership.txt", text: "Bicycle repairs are available every Saturday. The membership fee is 18 euros per month." }];

describe("persistent user knowledge bases", () => {
  it("restores uploaded knowledge after a browser reload and answers from it", async () => {
    const prepared = await prepareImport(metadata, files, "test");
    const stored = appendImport(null, prepared, sampleCatalog);
    const reloaded = loadImports(stored.serialized, sampleCatalog);
    const answer = investigateLocally({ knowledgeBaseId: prepared.catalog.knowledgeBases[0]._id, question: "What is the membership fee?" }, reloaded.catalog);
    expect(answer.answer).toContain("18 euros");
    expect(reloaded.imports).toHaveLength(1);
  });
  it("rejects duplicate document sets and preserves the original samples", async () => {
    const first = await prepareImport(metadata, files, "first");
    const second = await prepareImport(metadata, files, "second");
    const stored = appendImport(null, first, sampleCatalog);
    expect(() => appendImport(stored.serialized, second, sampleCatalog)).toThrow("already imported");
    const removed = removeImport(stored.serialized, first.catalog.knowledgeBases[0]._id, sampleCatalog);
    expect(removed.catalog).toEqual(sampleCatalog);
  });
  it("does not ignore corrupted or unsupported stored data", () => {
    expect(() => loadImports("{", sampleCatalog)).toThrow("could not be read");
    expect(() => loadImports('{"version":99,"imports":[]}', sampleCatalog)).toThrow();
  });
});