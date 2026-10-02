import { describe, expect, it } from "vitest";
import { knowledgeCatalogSchema, type Claim, type Intent, type KnowledgeCatalog } from "./knowledge";
import { compareEvidenceScenario, evidenceScenarioSchema, scenarioReport, type EvidenceScenario } from "./evidence-lab";
import { reasonOverEvidence } from "./reasoning";

const base = { _id: "test-base", title: "Synthetic reasoning tests", description: "Invented records for automated reasoning tests, not real policy.", kind: "synthetic" as const, mcpId: null, suggestedQuestions: [], showcase: [] };
const source = { _id: "source-one", knowledgeBaseId: base._id, title: "Synthetic manual", publisher: "Test fixture", url: "https://example.org/manual", authority: "primary" as const, publishedAt: "2026-01-01", reviewedAt: "2026-10-01" };
const claim: Claim = { _id: "claim-one", knowledgeBaseId: base._id, sourceId: source._id, subject: "Archive API", predicate: "maximum upload", value: "10 MB", statement: "The synthetic Archive API accepts uploads of up to 10 MB.", aliases: ["upload"], exclusive: true, version: null, effectiveFrom: "2026-01-01", effectiveUntil: null, conditions: [], relations: [] };
const intent: Intent = { summary: "Find the applicable upload limit.", subjects: ["Archive API"], predicates: ["maximum upload"], asOf: null, version: null, conditions: [] };
function catalog(claims: Claim[]): KnowledgeCatalog { return knowledgeCatalogSchema.parse({ knowledgeBases: [base], sources: [source], claims }); }
function reason(claims: Claim[], context: Partial<Intent> = {}, ids = claims.map((item) => item._id)) {
  return reasonOverEvidence({ knowledgeBaseId: base._id, question: "What upload limit applies?" }, { ...intent, ...context }, ids, catalog(claims), "sample", "2026-10-01");
}

describe("question-scoped evidence reasoning", () => {
  it("answers from canonical supporting claims", () => {
    const result = reason([claim]);
    expect(result.answer).toBe(claim.statement);
    expect(result.statements[0].claimIds).toEqual([claim._id]);
    expect(result.confidence).toBe("medium");
  });
  it("does not require one specific subject, host, or version", () => {
    const different = { ...claim, subject: "Camera mount", predicate: "adapter requirement" };
    expect(reason([different], { subjects: ["Camera mount"], predicates: ["adapter requirement"] }).status).toBe("answered");
  });
  it("returns insufficient evidence for an unrelated intent", () => {
    const result = reason([claim], { predicates: ["warranty length"] });
    expect(result.answer).toBe("Insufficient evidence in the Knowledge Base.");
    expect(result.sources).toEqual([]);
  });
  it.each([["4.2.2", "insufficient"], ["4.2.3", "answered"], ["4.2", "needs-context"], ["5.0.0", "insufficient"]])("evaluates version %s without inventing a patch version", (version, status) => {
    expect(reason([{ ...claim, version: { subject: "Archive API", range: ">=4.2.3 <5" } }], { version: { subject: "Archive API", value: version } }).status).toBe(status);
  });
  it("asks for a version when its absence changes applicability", () => {
    expect(reason([{ ...claim, version: { subject: "Archive API", range: ">=4 <5" } }]).status).toBe("needs-context");
  });
  it("uses effective dates, not source review dates", () => {
    const dated = { ...claim, effectiveFrom: "2026-06-01", effectiveUntil: "2026-09-01" };
    expect(reason([dated], { asOf: "2026-05-31" }).evidence[0].state).toBe("not-yet-effective");
    expect(reason([dated], { asOf: "2026-06-01" }).status).toBe("answered");
    expect(reason([dated], { asOf: "2026-09-01" }).evidence[0].state).toBe("expired");
  });
  it("does not invent historical applicability from a review date", () => {
    const result = reason([{ ...claim, effectiveFrom: null }], { asOf: "2020-01-01" });
    expect(result.status).toBe("needs-context");
    expect(result.followUp[0]).toContain("cannot be confirmed from its review date");
  });
  it("does not mistake different version scopes for a contradiction", () => {
    const records = [{ ...claim, version: { subject: "Archive API", range: ">=4 <5" } }, { ...claim, _id: "claim-two", value: "20 MB", version: { subject: "Archive API", range: ">=5 <6" } }];
    expect(reason(records, { version: { subject: "Archive API", value: "4.2.3" } }).conflicts).toEqual([]);
  });
  it("shows same-scope disagreements and refuses a silent winner", () => {
    const result = reason([claim, { ...claim, _id: "claim-two", value: "20 MB" }]);
    expect(result.status).toBe("conflict");
    expect(result.conflicts[0].claimIds).toEqual(["claim-one", "claim-two"]);
    expect(result.statements).toEqual([]);
  });
  it("uses an explicit correction only after it takes effect", () => {
    const correction: Claim = { ...claim, _id: "claim-two", value: "20 MB", statement: "The corrected synthetic upload limit is 20 MB.", effectiveFrom: "2026-07-01", relations: [{ kind: "corrects", targetId: claim._id, reason: "The published correction explicitly replaces the old limit." }] };
    expect(reason([claim, correction], { asOf: "2026-06-30" }).answer).toBe(claim.statement);
    const result = reason([claim, correction], { asOf: "2026-07-01" });
    expect(result.answer).toBe(correction.statement);
    expect(result.evidence[0].state).toBe("superseded");
    expect(result.conflicts[0].resolved).toBe(true);
  });
  it("does not follow a replacement whose conditions are not met", () => {
    const exception: Claim = { ...claim, _id: "claim-two", value: "20 MB", conditions: [{ key: "region", value: "EU" }], relations: [{ kind: "supersedes", targetId: claim._id, reason: "This replacement applies only in the stated region." }] };
    expect(reason([claim, exception], { conditions: [{ key: "region", value: "US" }] }).answer).toBe(claim.statement);
  });
  it("does not resolve missing relationship targets from unretrieved data", () => {
    const correction: Claim = { ...claim, _id: "claim-two", relations: [{ kind: "corrects", targetId: claim._id, reason: "A correction needs its original claim for comparison." }] };
    expect(reason([claim, correction], {}, [correction._id]).status).toBe("needs-context");
  });
  it("rejects circular precedence", () => {
    const first: Claim = { ...claim, relations: [{ kind: "supersedes", targetId: "claim-two", reason: "Synthetic cyclic relationship for testing." }] };
    const second: Claim = { ...claim, _id: "claim-two", relations: [{ kind: "supersedes", targetId: claim._id, reason: "Synthetic cyclic relationship for testing." }] };
    expect(reason([first, second]).status).toBe("needs-context");
  });
  it("does not call additive values contradictions", () => {
    expect(reason([{ ...claim, exclusive: false }, { ...claim, _id: "claim-two", value: "another supported format", exclusive: false }]).conflicts).toEqual([]);
  });
  it("requires alternative claims to be retrieved, not just the convenient one", () => {
    expect(reason([claim, { ...claim, _id: "claim-two", value: "20 MB" }], {}, [claim._id]).status).toBe("needs-context");
  });
  it("rejects cross-knowledge-base relationship targets", () => {
    expect(() => catalog([{ ...claim, relations: [{ kind: "related", targetId: "missing", reason: "This record is outside the selected corpus." }] }])).toThrow("same knowledge base");
  });
});

describe("hypothetical evidence scenarios", () => {
  const scenario: EvidenceScenario = { version: null, asOf: null, conditions: [], excludedSourceIds: [] };

  it("compares versions without changing the investigation or calling a model", () => {
    const previous = { ...claim, version: { subject: "Archive API", range: ">=4 <5" } };
    const next = { ...claim, _id: "claim-two", value: "20 MB", statement: "The synthetic Archive API version 5 accepts up to 20 MB.", version: { subject: "Archive API", range: ">=5 <6" } };
    const original = reason([previous, next], { version: { subject: "Archive API", value: "4" } });
    const snapshot = JSON.stringify(original);
    const compared = compareEvidenceScenario(original, { ...scenario, version: { subject: "Archive API", value: "5" } });
    expect(compared.rows.map((row) => [row.original.state, row.state])).toEqual([["applicable", "out-of-scope"], ["out-of-scope", "applicable"]]);
    expect(compared.changedCount).toBe(2);
    expect(compared.applicableCount).toBe(1);
    expect(compared).not.toHaveProperty("answer");
    expect(compared).not.toHaveProperty("confidence");
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("evaluates supplied conditions and an exclusive effective-until date", () => {
    const original = reason([{ ...claim, effectiveUntil: "2026-11-01", conditions: [{ key: "region", value: "EU" }] }], { conditions: [{ key: "region", value: "EU" }] });
    expect(compareEvidenceScenario(original, { ...scenario, conditions: [{ key: "region", value: "US" }] }).rows[0].state).toBe("out-of-scope");
    const compared = compareEvidenceScenario(original, { ...scenario, asOf: "2026-11-01", conditions: [{ key: "region", value: "EU" }] });
    expect(compared.rows[0].state).toBe("expired");
    expect(compared.rows[0].reasons[0]).toContain("exclusive");
  });

  it("keeps missing dates and partial versions uncertain", () => {
    const original = reason([{ ...claim, effectiveFrom: null, version: { subject: "Archive API", range: ">=4.2.3 <5" } }], { version: { subject: "Archive API", value: "4.2.3" } });
    const compared = compareEvidenceScenario(original, { ...scenario, version: { subject: "Archive API", value: "4.2" }, asOf: "2020-01-01" });
    expect(compared.rows[0].state).toBe("needs-context");
    expect(compared.rows[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining("cannot be confirmed"), expect.stringContaining("not wholly within")]));
  });

  it("never presents source exclusion as a resolution of the original conflict", () => {
    const sourceTwo = { ...source, _id: "source-two" };
    const second = { ...claim, _id: "claim-two", sourceId: sourceTwo._id, value: "20 MB", statement: "The alternate synthetic manual allows uploads of up to 20 MB." };
    const original = reasonOverEvidence({ knowledgeBaseId: base._id, question: "What upload limit applies?" }, intent, [claim._id, second._id], { knowledgeBases: [base], sources: [source, sourceTwo], claims: [claim, second] }, "sample", "2026-10-01");
    const context = { ...scenario, excludedSourceIds: [sourceTwo._id] };
    const compared = compareEvidenceScenario(original, context);
    expect(compared.rows[1].state).toBe("excluded");
    expect(compared.conflicts).toEqual([]);
    expect(original.status).toBe("conflict");
    const report = JSON.parse(scenarioReport(original, context));
    expect(report.kind).toBe("hypothetical");
    expect(report.scope).toContain("does not resolve the original disagreement");
    expect(report.original.status).toBe("conflict");
    expect(report.comparison.changes[1].after).toBe("excluded");
  });

  it("retains unresolved correction targets and handles excluding every source", () => {
    const correction: Claim = { ...claim, _id: "claim-two", relations: [{ kind: "corrects", targetId: claim._id, reason: "The original record is required for this correction." }] };
    const original = reason([claim, correction], {}, [correction._id]);
    expect(compareEvidenceScenario(original, scenario).rows[0].state).toBe("unresolved");
    const compared = compareEvidenceScenario(original, { ...scenario, excludedSourceIds: [source._id] });
    expect(compared.excludedCount).toBe(1);
    expect(compared.applicableCount).toBe(0);
    expect(compared.rows[0].state).toBe("excluded");
    expect(compareEvidenceScenario(reason([]), scenario).rows).toEqual([]);
  });

  it("rejects invalid dates, versions, duplicate conditions, and unobserved sources", () => {
    expect(evidenceScenarioSchema.safeParse({ ...scenario, asOf: "2026-02-30" }).success).toBe(false);
    expect(evidenceScenarioSchema.safeParse({ ...scenario, version: { subject: "Archive API", value: "latest" } }).success).toBe(false);
    expect(evidenceScenarioSchema.safeParse({ ...scenario, conditions: [{ key: "region", value: "EU" }, { key: "REGION", value: "US" }] }).success).toBe(false);
    expect(() => compareEvidenceScenario(reason([claim]), { ...scenario, excludedSourceIds: ["unknown-source"] })).toThrow("Only sources in the retrieved evidence");
  });
});