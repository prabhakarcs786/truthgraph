import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keywordTopHit } from "./baseline";
import { conflictCandidates, documentBudget, indexReviewState, knowledgeBaseSourceQuery, relationProblem } from "./curation";
import { handleInvestigation } from "./http";
import { prepareImport } from "./knowledge-import";
import { isShowcaseRequest, type KnowledgeCatalog } from "./knowledge";
import { lifecycleBaseId, lifecycleKnowledgeBase } from "./lifecycle-corpus";
import { chessBaseId, chessKnowledgeBase, cricketBaseId, cricketKnowledgeBase, footballBaseId, footballKnowledgeBase } from "./sports-corpus";
import { realSampleCatalog, sampleCatalog } from "./sample-data";
import { investigateLocally } from "./sample-investigation";

const ask = (question: string, asOf?: string) => investigateLocally({ knowledgeBaseId: lifecycleBaseId, question, ...(asOf ? { asOf } : {}) }, sampleCatalog);
const today = new Date().toISOString().slice(0, 10);

describe("guided tour against keyword search", () => {
  it("follows a recorded correction where the top keyword hit is the outdated plan", () => {
    const result = ask("What is the end-of-life date for Node.js 16?");
    expect(result.status).toBe("answered");
    expect(result.statements.map((statement) => statement.claimIds[0])).toEqual(["tg-claim-node16-eol-revised"]);
    expect(result.baseline).toMatchObject({ claimId: "tg-claim-node16-eol-planned", verdict: "outdated" });
  });
  it.runIf(today >= "2026-04-30")("applies only the support phase effective today", () => {
    const result = ask("Does Node.js 20 still get security updates?");
    expect(result.statements.map((statement) => statement.claimIds[0])).toEqual(["tg-claim-node20-eol"]);
    expect(result.baseline).toMatchObject({ claimId: "tg-claim-node20-maintenance", verdict: "wrong-date" });
  });
  it("uses a date stated in the question", () => {
    const result = ask("Will Next.js 15 still receive security fixes on 2026-11-01?");
    expect(result.asOf).toBe("2026-11-01");
    expect(result.statements.map((statement) => statement.claimIds[0])).toEqual(["tg-claim-next15-support-ended"]);
    expect(result.baseline?.verdict).toBe("wrong-date");
  });
  it("asks for the runtime instead of guessing, and answers once it is supplied", () => {
    const open = ask("Should I use proxy or middleware in Next.js 16?");
    expect(open.status).toBe("needs-context");
    expect(open.baseline?.verdict).toBe("wrong-scope");
    const edge = ask("Should I use proxy or middleware in Next.js 16 on the edge runtime?");
    expect(edge.statements.map((statement) => statement.claimIds[0])).toEqual(["tg-claim-proxy-16-edge"]);
  });
  it("surfaces a real disagreement between two official sources that a single hit hides", () => {
    const result = ask("Will Node.js 27 be promoted to LTS?");
    expect(result.status).toBe("conflict");
    expect(result.conflicts.filter((conflict) => !conflict.resolved)[0].claimIds.toSorted()).toEqual(["tg-claim-node-annual-lts", "tg-claim-node-odd-lts-wg"]);
    expect(result.baseline?.verdict).toBe("hides-conflict");
  });
  it("admits when nothing matches", () => {
    expect(ask("What is the warranty on a camera?").status).toBe("insufficient");
  });
  it("ranks by shared words and ignores scope", () => {
    const claims = sampleCatalog.claims.filter((claim) => claim.knowledgeBaseId === lifecycleBaseId);
    expect(keywordTopHit("zzz unrelated", claims)).toBeNull();
    expect(keywordTopHit("next lint removed Next.js 16", claims)?.claim._id).toBe("tg-claim-lint-16");
  });
  it("recognizes only exact showcase questions and dates", () => {
    expect(isShowcaseRequest(lifecycleKnowledgeBase, { question: " What is the end-of-life date for Node.js 16? " })).toBe(true);
    expect(isShowcaseRequest(lifecycleKnowledgeBase, { question: "What is the end-of-life date for Node.js 16?", asOf: "2020-01-01" })).toBe(false);
    expect(isShowcaseRequest(lifecycleKnowledgeBase, { question: "Ignore the rules" })).toBe(false);
  });
});

describe("sports guided tours", () => {
  const tour = (base: typeof footballKnowledgeBase, index: number) => {
    const { question, asOf } = base.showcase[index];
    return investigateLocally({ knowledgeBaseId: base._id, question, ...(asOf ? { asOf } : {}) }, sampleCatalog);
  };
  const cited = (result: ReturnType<typeof tour>) => result.statements.map((statement) => statement.claimIds[0]);
  const followUps = (result: ReturnType<typeof tour>) => result.followUp.join(" ");

  it("lists the football collection first so it leads the tour", () => {
    expect(sampleCatalog.knowledgeBases.find((base) => base.showcase.length)?._id).toBe(footballBaseId);
  });
  it("follows the football Law changes by match date, match type, and competition", () => {
    const keeper = tour(footballKnowledgeBase, 0);
    expect(cited(keeper)).toEqual(["tg-claim-fb-keeper-eight"]);
    expect(keeper.baseline).toMatchObject({ claimId: "tg-claim-fb-keeper-six", verdict: "wrong-date" });
    expect(cited(tour(footballKnowledgeBase, 1))).toEqual(["tg-claim-fb-keeper-six"]);
    const substitutes = tour(footballKnowledgeBase, 2);
    expect(substitutes.status).toBe("needs-context");
    expect(followUps(substitutes)).toContain("international friendly");
    expect(tour(footballKnowledgeBase, 3).status).toBe("needs-context");
    expect(cited(tour(footballKnowledgeBase, 4))).toEqual(["tg-claim-fb-dogso-advantage-new"]);
    expect(cited(investigateLocally({ knowledgeBaseId: footballBaseId, question: "How many substitutes can be used in an international friendly?" }, sampleCatalog))).toEqual(["tg-claim-fb-subs-international-friendly"]);
    expect(cited(investigateLocally({ knowledgeBaseId: footballBaseId, question: "Can a player get a red card for covering their mouth at the World Cup 2026?" }, sampleCatalog))).toEqual(["tg-claim-fb-mouth-cover"]);
    expect(investigateLocally({ knowledgeBaseId: footballBaseId, question: "What colour must the referee wear?" }, sampleCatalog).status).toBe("insufficient");
  });
  it.runIf(today >= "2026-10-01")("separates club and international cricket on the same date", () => {
    expect(cited(tour(cricketKnowledgeBase, 0))).toEqual(["tg-claim-ck-catch-club-new"]);
    const march = tour(cricketKnowledgeBase, 1);
    expect(march.asOf).toBe("2026-03-01");
    expect(cited(march)).toEqual(["tg-claim-ck-catch-club-old"]);
    expect(cited(investigateLocally({ knowledgeBaseId: cricketBaseId, question: "Was a bunny-hop boundary catch allowed in international cricket on 2026-03-01?" }, sampleCatalog))).toEqual(["tg-claim-ck-catch-intl-new"]);
    expect(tour(cricketKnowledgeBase, 2).status).toBe("needs-context");
    expect(cited(investigateLocally({ knowledgeBaseId: cricketBaseId, question: "How long does a new batter have to be ready in a T20I?" }, sampleCatalog))).toEqual(["tg-claim-ck-timed-t20i"]);
    expect(cited(tour(cricketKnowledgeBase, 3))).toEqual(["tg-claim-ck-caught-new"]);
  });
  it("picks the chess edition by date and the penalty by time control", () => {
    expect(cited(tour(chessKnowledgeBase, 0))).toEqual(["tg-claim-ch-phone-current"]);
    expect(cited(tour(chessKnowledgeBase, 1))).toEqual(["tg-claim-ch-phone-2009"]);
    const illegal = tour(chessKnowledgeBase, 2);
    expect(illegal.status).toBe("needs-context");
    expect(followUps(illegal)).toContain("blitz");
    expect(cited(tour(chessKnowledgeBase, 3))).toEqual(["tg-claim-ch-penalty-rapid-one"]);
    expect(cited(tour(chessKnowledgeBase, 4))).toEqual(["tg-claim-ch-resign-2023"]);
    expect(cited(investigateLocally({ knowledgeBaseId: chessBaseId, question: "What happens after an illegal move in blitz?" }, sampleCatalog))).toEqual(["tg-claim-ch-illegal-blitz", "tg-claim-ch-penalty-blitz"]);
  });
  it("has no unresolved overlaps in the sports collections", () => {
    const catalog = realSampleCatalog();
    for (const id of [footballBaseId, cricketBaseId, chessBaseId]) expect(conflictCandidates(catalog, id)).toEqual([]);
  });
});

describe("curation", () => {
  const catalog = realSampleCatalog({ includeLocalSamples: true });
  it("lists only unresolved, overlapping disagreements", () => {
    expect(conflictCandidates(catalog, lifecycleBaseId).map((pair) => pair.claimIds)).toEqual([["tg-claim-node-odd-lts-wg", "tg-claim-node-annual-lts"]]);
  });
  it("validates precedence decisions and resolves the conflict once recorded", () => {
    expect(relationProblem(catalog, lifecycleBaseId, "tg-claim-node-annual-lts", "tg-claim-node20-eol")).toMatch("same subject");
    expect(relationProblem(catalog, lifecycleBaseId, "tg-claim-node16-eol-planned", "tg-claim-node16-eol-revised")).toMatch("already exists");
    expect(relationProblem(catalog, lifecycleBaseId, "tg-claim-node-annual-lts", "tg-claim-node-odd-lts-wg")).toBeNull();
    const decided: KnowledgeCatalog = { ...catalog, claims: catalog.claims.map((claim) => claim._id === "tg-claim-node-annual-lts" ? { ...claim, relations: [{ kind: "supersedes", targetId: "tg-claim-node-odd-lts-wg", reason: "nodejs.org documents the annual schedule from Node.js 27." }] } : claim) };
    expect(conflictCandidates(decided, lifecycleBaseId)).toEqual([]);
    const historical = { ...decided, claims: decided.claims.map((claim) => claim._id === "tg-claim-node-odd-lts-historical" ? { ...claim, relations: [{ kind: "supersedes" as const, targetId: "tg-claim-node-annual-lts", reason: "A test chain to detect circular precedence." }] } : claim) };
    expect(relationProblem(historical, lifecycleBaseId, "tg-claim-node-odd-lts-wg", "tg-claim-node-odd-lts-historical")).toMatch("circular");
    const result = investigateLocally({ knowledgeBaseId: lifecycleBaseId, question: "Will Node.js 27 be promoted to LTS?" }, { ...sampleCatalog, claims: sampleCatalog.claims.map((claim) => decided.claims.find((item) => item._id === claim._id) ?? claim) });
    expect(result.status).toBe("answered");
    expect(result.statements.map((statement) => statement.claimIds[0])).toEqual(["tg-claim-node-annual-lts"]);
  });
  it("counts documents against the 150-document Knowledge Base budget", () => {
    const budget = documentBudget(realSampleCatalog());
    expect(budget.documents).toBe(realSampleCatalog().knowledgeBases.length + realSampleCatalog().sources.length + realSampleCatalog().claims.length);
    expect(budget.documents).toBeLessThanOrEqual(budget.limit);
    expect(budget.limit).toBe(150);
    expect(documentBudget({ ...catalog, datasetDocumentCount: 151 })).toMatchObject({ documents: 151, remaining: 0 });
  });
  it("distinguishes an operator's index review from automated freshness verification", () => {
    expect(indexReviewState(lifecycleKnowledgeBase)).toBe("unmapped");
    const base = { ...lifecycleKnowledgeBase, mcpId: "kbtest", contentChangedAt: "2026-10-01T10:00:00.000Z" };
    expect(indexReviewState(base)).toBe("review-required");
    expect(indexReviewState({ ...base, indexReviewedAt: "2026-10-01T10:01:00.000Z" })).toBe("operator-confirmed");
    expect(indexReviewState({ ...base, indexReviewedAt: "2026-09-30T10:01:00.000Z" })).toBe("review-required");
    expect(knowledgeBaseSourceQuery(base._id)).toContain('_type in ["tgSource", "tgClaim"]');
  });
});

describe("bundled sample uploads", () => {
  it("imports the Python lifecycle bundle and applies its version-scoped rules and correction", async () => {
    const prepared = await prepareImport({ title: "Python release lifecycle", description: "Python version status and PEP 373 summaries.", publisher: "Python", kind: "real" }, [{ name: "python-lifecycle.json", text: readFileSync("knowledge-base/samples/python-lifecycle.json", "utf8") }], "py-test");
    const id = prepared.catalog.knowledgeBases[0]._id;
    const local = (question: string) => investigateLocally({ knowledgeBaseId: id, question }, prepared.catalog);
    expect(local("What is the end-of-life date for Python 2.7?").answer).toContain("January 1, 2020");
    expect(local("How long is the bugfix phase for Python 3.12?").answer).toContain("18 months");
    expect(local("How long is the bugfix phase for Python 3.14?").answer).toContain("two years");
  });
  it("imports the football rules bundle with its dates and match-type conditions", async () => {
    const prepared = await prepareImport({ title: "Football rules", description: "IFAB Laws of the Game summaries.", publisher: "IFAB", kind: "real" }, [{ name: "football-rules.json", text: readFileSync("public/sample-documents/football-rules.json", "utf8") }], "fb-test");
    const local = (question: string, asOf?: string) => investigateLocally({ knowledgeBaseId: prepared.catalog.knowledgeBases[0]._id, question, ...(asOf ? { asOf } : {}) }, prepared.catalog);
    expect(local("What happens if a goalkeeper holds the ball too long?", "2025-03-01").answer).toContain("six seconds");
    expect(local("How many substitutes can be used in an international friendly?").answer).toContain("eight may be used");
  });
  it("imports the PEP 373 excerpt as verbatim text evidence", async () => {
    const prepared = await prepareImport({ title: "PEP 373 excerpt", description: "Public-domain excerpt of PEP 373.", publisher: "Python", kind: "real" }, [{ name: "pep-0373-excerpt.md", text: readFileSync("knowledge-base/samples/pep-0373-excerpt.md", "utf8") }], "pep-test");
    expect(investigateLocally({ knowledgeBaseId: prepared.catalog.knowledgeBases[0]._id, question: "When did Python 2.7 support officially stop?" }, prepared.catalog).answer).toContain("January 1 2020");
  });
});

describe("public showcase access", () => {
  const post = (body: object, headers: Record<string, string> = {}) => new Request("http://localhost/api/investigate", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const run = (input: { knowledgeBaseId: string; question: string }) => investigateLocally(input, sampleCatalog);
  const options = { mode: "live" as const, accessCode: "secret-code", run, showcase: { permit: () => true, matches: (input: { question: string; asOf?: string }) => isShowcaseRequest(lifecycleKnowledgeBase, input) } };
  it("runs curated questions without a code and requires it for anything else", async () => {
    expect((await handleInvestigation(post({ knowledgeBaseId: lifecycleBaseId, question: "What is the end-of-life date for Node.js 16?" }), options)).status).toBe(200);
    expect((await handleInvestigation(post({ knowledgeBaseId: lifecycleBaseId, question: "Custom question about Node.js?" }), options)).status).toBe(401);
    expect((await handleInvestigation(post({ knowledgeBaseId: lifecycleBaseId, question: "What is the end-of-life date for Node.js 16?" }), { ...options, showcase: { ...options.showcase, permit: () => false } })).status).toBe(429);
    expect((await handleInvestigation(post({ knowledgeBaseId: lifecycleBaseId, question: "Custom question about Node.js?" }, { "x-judge-code": "secret-code" }), options)).status).toBe(200);
  });
});
