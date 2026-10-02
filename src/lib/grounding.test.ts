import { describe, expect, it } from "vitest";
import { contentText, groundPlan } from "./grounding";
import { sampleCatalog } from "./sample-data";
import { selectSampleEvidence } from "./sample-investigation";

const request = { knowledgeBaseId: "tg-kb-framework-notes", question: "What runtime does Next.js 16 require?" };
const catalog = { ...sampleCatalog, knowledgeBases: sampleCatalog.knowledgeBases.map((base) => ({ ...base, mcpId: "kbtest" })) };
const plan = selectSampleEvidence(request);
const text = catalog.claims.map((claim) => `${claim._id}\n${claim.statement}\n${catalog.sources.find((source) => source._id === claim.sourceId)?.url}`).join("\n");
const entries = [{ knowledgeBase: "kbtest", paths: ["sample/runtime"], text }];

describe("MCP evidence grounding", () => {
  it("accepts only a claim with its source and current statement in retrieved text", () => {
    expect(groundPlan(plan, entries, request, catalog).claimIds).toEqual(plan.claimIds);
  });
  it("accepts a synthesized Context entry that cites each claim by ID", () => {
    const synthesized = [{ knowledgeBase: "kbtest", paths: ["requirements/node_runtime"], text: `# Summary in the Knowledge Base's own words\n\n## Sources\n${plan.claimIds.map((id, index) => `${index + 1}. ${id} — Dataset`).join("\n")}` }];
    expect(groundPlan(plan, synthesized, request, catalog).claimIds).toEqual(plan.claimIds);
  });
  it("does not treat a longer claim ID as a citation of a shorter one", () => {
    const [first] = plan.claimIds;
    expect(() => groundPlan({ ...plan, claimIds: [first] }, [{ ...entries[0], text: `Sources: ${first}-extended, x${first}` }], request, catalog)).toThrow("not found");
  });
  it("ignores only deleted records with retrieved citations and rejects invented records", () => {
    const ignored = groundPlan({ ...plan, claimIds: ["deleted-record"] }, [{ ...entries[0], text: "Sources: deleted-record" }], request, catalog);
    expect(ignored.claimIds).toEqual([]);
    expect(ignored.ignoredIds).toEqual(["deleted-record"]);
    expect(() => groundPlan({ ...plan, claimIds: ["invented"] }, entries, request, catalog)).toThrow("configured knowledge base");
    expect(() => groundPlan(plan, [{ ...entries[0], text: "Only a source link without its claim" }], request, catalog)).toThrow("not found");
    expect(() => groundPlan(plan, [{ ...entries[0], knowledgeBase: "kbother" }], request, catalog)).toThrow("not found");
    expect(() => groundPlan({ ...plan, claimIds: [plan.claimIds[0], plan.claimIds[0]] }, entries, request, catalog)).toThrow("Duplicate");
  });
  it("accepts a truthful no-evidence result without inventing a citation", () => {
    expect(groundPlan({ ...plan, claimIds: [] }, [], request, catalog).claimIds).toEqual([]);
  });
  it("ignores filter names that do not exist in the corpus but keeps stored ones", () => {
    const [claim] = catalog.claims.filter((candidate) => candidate.knowledgeBaseId === request.knowledgeBaseId);
    const guessed = { ...plan, intent: { ...plan.intent, subjects: [claim.subject, "Deno"], predicates: ["requires", claim.predicate] } };
    const grounded = groundPlan(guessed, entries, request, catalog);
    expect(grounded.intent.subjects).toEqual([claim.subject]);
    expect(grounded.intent.predicates).toEqual([claim.predicate]);
  });
  it("keeps only dates the question states and an explicit asOf", () => {
    const inferred = { ...plan, intent: { ...plan.intent, asOf: "2031-05-05" } };
    expect(groundPlan(inferred, entries, request, catalog).intent.asOf).toBeNull();
    expect(groundPlan(inferred, entries, { ...request, question: "What applied in May 2031?" }, catalog).intent.asOf).toBe("2031-05-05");
    expect(groundPlan(inferred, entries, { ...request, asOf: "2030-01-01" }, catalog).intent.asOf).toBe("2030-01-01");
    expect(groundPlan({ ...plan, intent: { ...plan.intent, asOf: null } }, entries, { ...request, question: "Is Next.js 15 supported on 2026-11-01?" }, catalog).intent.asOf).toBe("2026-11-01");
  });
  it("keeps only conditions the question mentions", () => {
    const inferred = { ...plan, intent: { ...plan.intent, conditions: [{ key: "runtime", value: "edge" }] } };
    expect(groundPlan(inferred, entries, request, catalog).intent.conditions).toEqual([]);
    expect(groundPlan(inferred, entries, { ...request, question: "What runtime does Next.js 16 require on the Edge?" }, catalog).intent.conditions).toEqual([{ key: "runtime", value: "edge" }]);
  });
  it("adds cited alternatives for the same fact instead of reporting them missing", () => {
    const same = (first: typeof catalog.claims[number], second: typeof catalog.claims[number]) => first._id !== second._id && first.subject === second.subject && first.predicate === second.predicate;
    const claims = catalog.claims.filter((candidate) => candidate.knowledgeBaseId === request.knowledgeBaseId);
    const claim = claims.find((candidate) => claims.some((peer) => same(candidate, peer)))!;
    const peer = claims.find((candidate) => same(claim, candidate))!;
    const cited = [{ knowledgeBase: "kbtest", paths: ["summary"], text: `Sources: ${claim._id}, ${peer._id}` }];
    expect(groundPlan({ ...plan, claimIds: [claim._id] }, cited, request, catalog).claimIds).toEqual(expect.arrayContaining([claim._id, peer._id]));
    expect(groundPlan({ ...plan, claimIds: [claim._id] }, [{ ...cited[0], text: `Sources: ${claim._id}` }], request, catalog).claimIds).toEqual([claim._id]);
  });
  it("rejects malformed model output", () => {
    expect(() => groundPlan({ answer: "trust me" }, entries, request, catalog)).toThrow();
  });
  it("does not mistake a tool error for evidence", () => {
    expect(() => contentText({ isError: true, content: [{ text: "error" }] })).toThrow("tool error");
    expect(contentText({ content: [{ type: "text", text: "Actual evidence" }] })).toContain("Actual evidence");
    expect(() => contentText("x".repeat(250_001))).toThrow("budget");
  });
});