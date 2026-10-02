import { describe, expect, it } from "vitest";
import { contentIdentifier, exportImportMarkdown, mergeCatalogs, prepareImport, validatePreparedImport } from "./knowledge-import";
import { sampleCatalog } from "./sample-data";
import { selectSampleEvidence } from "./sample-investigation";
import { reasonOverEvidence } from "./reasoning";

const metadata = { title: "Community workshop", description: "Uploaded workshop opening hours and membership information.", publisher: "Workshop owner", kind: "real" as const };
const document = { name: "opening-hours.md", text: "The community workshop opens at 07:30 on Saturdays. Members may borrow tools for seven days." };

describe("dynamic knowledge imports", () => {
  it("turns new text into inspectable, attributable excerpts and answers new questions", async () => {
    const prepared = await prepareImport(metadata, [document], "test");
    const catalog = mergeCatalogs(sampleCatalog, prepared.catalog);
    const request = { knowledgeBaseId: prepared.catalog.knowledgeBases[0]._id, question: "When does the workshop open on Saturdays?" };
    const plan = selectSampleEvidence(request, catalog);
    const answer = reasonOverEvidence(request, plan.intent, plan.claimIds, catalog, "sample");
    expect(answer.answer).toContain("07:30");
    expect(answer.evidence[0].source.fileName).toBe(document.name);
    expect(answer.evidence[0].source.url).toBe(await contentIdentifier(document.text));
    expect(answer.confidence).toBe("medium");
  });
  it("does not invent source authority, dates, version rules, or conflicts", async () => {
    const result = await prepareImport(metadata, [document], "test");
    expect(result.catalog.sources[0].authority).toBe("unverified");
    expect(result.catalog.sources[0].publishedAt).toBeNull();
    expect(result.catalog.claims[0]).toMatchObject({ version: null, effectiveFrom: null, effectiveUntil: null, exclusive: false, relations: [] });
    expect(result.catalog.knowledgeBases[0].mcpId).toBeNull();
  });
  it("rekeys imported JSON references and discards unverified remote mappings", async () => {
    const base = sampleCatalog.knowledgeBases[0];
    const input = { knowledgeBases: [{ ...base, mcpId: "kbexisting" }], sources: sampleCatalog.sources.filter((source) => source.knowledgeBaseId === base._id), claims: sampleCatalog.claims.filter((claim) => claim.knowledgeBaseId === base._id) };
    const result = await prepareImport(metadata, [{ name: "corpus.json", text: JSON.stringify(input) }], "test");
    expect(result.catalog.knowledgeBases[0].mcpId).toBeNull();
    expect(result.catalog.claims.every((claim) => result.catalog.sources.some((source) => source._id === claim.sourceId))).toBe(true);
    expect(() => mergeCatalogs(sampleCatalog, result.catalog)).not.toThrow();
  });
  it("rejects unsupported/binary files, excessive sizes, malformed JSON, and missing references", async () => {
    await expect(prepareImport(metadata, [{ name: "manual.pdf", text: "fake PDF data" }])).rejects.toThrow("supported");
    await expect(prepareImport(metadata, [{ ...document, text: "bad\u0000binary" }])).rejects.toThrow("supported");
    await expect(prepareImport(metadata, [{ ...document, text: "é".repeat(150_000) }])).rejects.toThrow("256 KB");
    await expect(prepareImport(metadata, [{ name: "invalid.json", text: "{" }])).rejects.toThrow("valid JSON");
  });
  it("detects modified fingerprints and excerpts before persisting", async () => {
    const result = await prepareImport(metadata, [document], "test");
    await expect(validatePreparedImport({ ...result, uploads: [{ ...result.uploads[0], text: `${document.text} appended` }] })).rejects.toThrow("fingerprint");
    result.catalog.claims[0].statement = "This claim never appeared in the uploaded document.";
    await expect(validatePreparedImport(result)).rejects.toThrow("verbatim");
  });
  it("exports exact provenance for Knowledge Base indexing and round-trips uploads", async () => {
    const result = await prepareImport(metadata, [document], "test");
    expect(exportImportMarkdown(result)).toContain(result.catalog.sources[0].url);
    const roundTrip = await prepareImport(metadata, [{ name: "saved.json", text: JSON.stringify(result) }], "next");
    expect(roundTrip.uploads[0].text).toBe(document.text);
    expect(roundTrip.catalog.claims[0].statement).toBe(document.text);
  });
  it("can reimport an exported bundle larger than the raw-text limit", async () => {
    const prepared = await prepareImport(metadata, [{ ...document, text: `${document.text}\n`.repeat(1500) }], "large");
    const text = JSON.stringify(prepared, null, 2);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(256 * 1024);
    const restored = await prepareImport(metadata, [{ name: "export.json", text }], "restored");
    expect(restored.uploads[0].text).toBe(prepared.uploads[0].text);
    expect(restored.catalog.claims).toHaveLength(prepared.catalog.claims.length);
  });
});