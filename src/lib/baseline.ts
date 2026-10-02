import { type Baseline, type Claim, type Intent, type Investigation, type InvestigationRequest, type KnowledgeCatalog, selectKnowledgeBase } from "./knowledge";
import { reasonOverEvidence } from "./reasoning";

const stopWords = new Set("a an the what which is are was were does do did can could should would will how when why in on for of to and or with it its me my i tell explain only about use this that please be been by from as at".split(" "));
const tokens = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((token) => token && !stopWords.has(token));

/** Plain keyword ranking over statement text (IDF-weighted term overlap); it ignores dates, versions, conditions, and relationships. Ties keep corpus order. */
export function keywordTopHit(question: string, claims: Claim[]): { claim: Claim; score: number } | null {
  const documents = claims.map((claim) => new Set(tokens(`${claim.subject} ${claim.predicate} ${claim.statement}`)));
  const weight = (term: string) => Math.log(1 + claims.length / documents.filter((document) => document.has(term)).length);
  const terms = [...new Set(tokens(question))];
  let best: { claim: Claim; score: number } | null = null;
  claims.forEach((claim, index) => {
    const score = terms.filter((term) => documents[index].has(term)).reduce((total, term) => total + weight(term), 0);
    if (score > 0 && (!best || score > best.score + 1e-9)) best = { claim, score };
  });
  return best;
}

export function compareWithBaseline(request: InvestigationRequest, intent: Intent, claimIds: string[], catalog: KnowledgeCatalog, result: Investigation): Baseline {
  const { claims, sources } = selectKnowledgeBase(catalog, request.knowledgeBaseId);
  const hit = keywordTopHit(request.question, claims);
  const method = "keyword-top-hit" as const;
  if (!hit) return { method, claimId: null, statement: null, sourceTitle: null, verdict: "no-match", explanation: result.status === "insufficient" ? "Keyword search finds nothing either; neither approach invents an answer." : "No stored statement shares words with the question; TruthGraph found the evidence through the Knowledge Base's structured entries." };
  const id = hit.claim._id;
  const item = result.evidence.find((evidence) => evidence.claim._id === id)
    ?? reasonOverEvidence(request, intent, [...new Set([...claimIds, id])], catalog, result.mode, result.asOf).evidence.find((evidence) => evidence.claim._id === id);
  const base = { method, claimId: id, statement: hit.claim.statement, sourceTitle: sources.find((source) => source._id === hit.claim.sourceId)?.title ?? null };
  if (!item) return { ...base, verdict: "unrelated", explanation: "TruthGraph judged this record unrelated to the subject and property the question asks about." };
  const reasons = item.reasons.join(" ");
  switch (item.state) {
    case "superseded": return { ...base, verdict: "outdated", explanation: `Outdated. ${reasons}` };
    case "out-of-scope": return { ...base, verdict: "wrong-scope", explanation: `Wrong scope. ${reasons}` };
    case "expired":
    case "not-yet-effective": return { ...base, verdict: "wrong-date", explanation: `Not in effect on ${result.asOf}. ${reasons}` };
    case "needs-context":
    case "unresolved": return { ...base, verdict: "missing-context", explanation: `Answers too early. ${reasons}` };
  }
  if (result.status === "conflict") return { ...base, verdict: "hides-conflict", explanation: "This record applies, but another applicable source disagrees and nothing recorded establishes precedence. A single top hit hides the disagreement." };
  if (result.status === "needs-context") return { ...base, verdict: "missing-context", explanation: `Answers too early. TruthGraph still needs: ${result.followUp[0] ?? "related evidence"}` };
  return { ...base, verdict: "agrees", explanation: "Keyword search reaches the same record here. TruthGraph adds why it applies: its scope, dates, and source." };
}
