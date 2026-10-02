import { intersects, subset } from "semver";
import { type Claim, type Conflict, type EvidenceItem, type Intent, type Investigation, type InvestigationRequest, type KnowledgeCatalog, selectKnowledgeBase } from "./knowledge";

const normalized = (value: string) => value.trim().toLowerCase();
const sameFact = (first: Claim, second: Claim) => normalized(first.subject) === normalized(second.subject) && normalized(first.predicate) === normalized(second.predicate);

function scope(claim: Claim, intent: Intent, asOf: string, dateRequested: boolean): Pick<EvidenceItem, "state" | "reasons"> {
  if (claim.effectiveFrom && claim.effectiveFrom > asOf) return { state: "not-yet-effective", reasons: [`Effective from ${claim.effectiveFrom}, after the requested date.`] };
  if (claim.effectiveUntil && claim.effectiveUntil <= asOf) return { state: "expired", reasons: [`Effective until ${claim.effectiveUntil} (exclusive).`] };
  const missing: string[] = [];
  if (dateRequested && !claim.effectiveFrom && !claim.effectiveUntil) missing.push(`No effective dates are recorded for ${claim._id}; applicability on ${asOf} cannot be confirmed from its review date.`);
  if (claim.version) {
    if (!intent.version || normalized(intent.version.subject) !== normalized(claim.version.subject)) missing.push(`Which ${claim.version.subject} version applies?`);
    else if (!intersects(intent.version.value, claim.version.range)) return { state: "out-of-scope", reasons: [`Version ${intent.version.value} does not overlap ${claim.version.subject} ${claim.version.range}.`] };
    else if (!subset(intent.version.value, claim.version.range)) missing.push(`Specify the exact ${claim.version.subject} version: ${intent.version.value} overlaps but is not wholly within ${claim.version.range}.`);
  }
  for (const condition of claim.conditions) {
    const provided = intent.conditions.find((item) => normalized(item.key) === normalized(condition.key));
    if (!provided) missing.push(`What is the ${condition.key}? This claim applies to ${condition.value}.`);
    else if (normalized(provided.value) !== normalized(condition.value)) return { state: "out-of-scope", reasons: [`Requires ${condition.key} = ${condition.value}; supplied ${provided.value}.`] };
  }
  if (missing.length) return { state: "needs-context", reasons: missing };
  return { state: "applicable", reasons: [claim.effectiveFrom || claim.effectiveUntil ? `Effective on ${asOf}.` : "No effective-date restriction is recorded; a review date is not an effective date.", ...(claim.version ? [`Version ${intent.version?.value} falls within ${claim.version.range}.`] : [])] };
}

export function reasonOverEvidence(request: InvestigationRequest, intent: Intent, ids: string[], catalog: KnowledgeCatalog, mode: Investigation["mode"], today = new Date().toISOString().slice(0, 10)): Investigation {
  const { knowledgeBase, claims, sources } = selectKnowledgeBase(catalog, request.knowledgeBaseId);
  const sourceMap = new Map(sources.map((source) => [source._id, source]));
  const asOf = request.asOf || intent.asOf || today;
  const effectiveIntent = { ...intent, asOf };
  const requested = new Set(ids);
  const selected = claims.filter((claim) => requested.has(claim._id) && (!intent.subjects.length || intent.subjects.some((subject) => normalized(subject) === normalized(claim.subject))) && (!intent.predicates.length || intent.predicates.some((predicate) => normalized(predicate) === normalized(claim.predicate))));
  const evidence: EvidenceItem[] = selected.map((claim) => ({ claim, source: sourceMap.get(claim.sourceId)!, ...scope(claim, effectiveIntent, asOf, Boolean(request.asOf || intent.asOf)), replacedBy: [] }));
  const map = new Map(evidence.map((item) => [item.claim._id, item]));
  const followUp = new Set<string>();
  if (ids.some((id) => !claims.some((claim) => claim._id === id))) followUp.add("One or more retrieved record IDs are not in the selected knowledge base.");
  for (const peer of claims) {
    if (requested.has(peer._id) || !selected.some((claim) => sameFact(claim, peer))) continue;
    // An alternative outside the requested version, date, or condition cannot change the answer.
    if (["out-of-scope", "expired", "not-yet-effective"].includes(scope(peer, effectiveIntent, asOf, Boolean(request.asOf || intent.asOf)).state)) continue;
    followUp.add(`Retrieve alternative or historical claim ${peer._id} before concluding; its content has not been used as evidence.`);
  }

  const replacements = new Map<string, string[]>();
  for (const item of evidence) {
    const links = item.claim.relations.filter((link) => ["supersedes", "corrects"].includes(link.kind));
    replacements.set(item.claim._id, links.map((link) => link.targetId));
    for (const link of links) {
      const target = map.get(link.targetId);
      if (!target) {
        if (item.state === "applicable") { item.state = "unresolved"; item.reasons.push("A correction/supersession target was not retrieved."); }
        followUp.add(`Retrieve related claim ${link.targetId} before resolving this relationship.`);
      } else if (!sameFact(item.claim, target.claim)) {
        item.state = "unresolved"; item.reasons.push("A replacement relationship points to a different subject or predicate.");
      }
    }
  }
  const cycle = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string, path: string[]) {
    const index = path.indexOf(id);
    if (index !== -1) { path.slice(index).forEach((member) => cycle.add(member)); return; }
    if (visited.has(id)) return;
    for (const next of replacements.get(id) || []) if (map.has(next)) visit(next, [...path, id]);
    visited.add(id);
  }
  evidence.forEach((item) => visit(item.claim._id, []));
  for (const id of cycle) { const item = map.get(id)!; item.state = "unresolved"; item.reasons.push("Circular supersession cannot establish precedence."); }

  const initiallyApplicable = evidence.filter((item) => item.state === "applicable");
  for (const item of initiallyApplicable) {
    for (const link of item.claim.relations.filter((relation) => ["supersedes", "corrects"].includes(relation.kind))) {
      const target = map.get(link.targetId);
      if (target && initiallyApplicable.includes(target) && !cycle.has(target.claim._id)) {
        target.state = "superseded"; target.replacedBy.push(item.claim._id);
        target.reasons.push(`${link.kind === "corrects" ? "Corrected" : "Superseded"} by ${item.claim._id}: ${link.reason}`);
      }
    }
  }

  const conflicts: Conflict[] = [];
  for (let firstIndex = 0; firstIndex < initiallyApplicable.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < initiallyApplicable.length; secondIndex++) {
      const first = initiallyApplicable[firstIndex]; const second = initiallyApplicable[secondIndex];
      if (!first.claim.exclusive || !second.claim.exclusive || !sameFact(first.claim, second.claim) || normalized(first.claim.value) === normalized(second.claim.value)) continue;
      const resolved = first.state === "superseded" || second.state === "superseded";
      conflicts.push({ claimIds: [first.claim._id, second.claim._id], resolved, resolution: resolved ? "An explicit, applicable correction or supersession relationship establishes precedence; both claims remain visible." : "Both claims apply, and no explicit relationship establishes which replaces the other. Publication date or authority alone does not settle this disagreement.", resolutionClaimIds: [...new Set([...first.replacedBy, ...second.replacedBy])] });
    }
  }
  for (const item of evidence) if (item.state === "needs-context" || item.state === "unresolved") item.reasons.forEach((reason) => followUp.add(reason));
  const applicable = evidence.filter((item) => item.state === "applicable").sort((first, second) => Number(second.source.authority === "primary") - Number(first.source.authority === "primary"));
  const disputed = conflicts.some((conflict) => !conflict.resolved);
  const incomplete = evidence.some((item) => item.state === "needs-context" || item.state === "unresolved") || followUp.size > 0;
  const status = disputed ? "conflict" : incomplete ? "needs-context" : applicable.length ? "answered" : "insufficient";
  const confidence = status === "insufficient" ? "insufficient" : status !== "answered" ? "low" : applicable.every((item) => item.source.authority === "primary") && knowledgeBase.kind === "real" ? "high" : "medium";
  const statements = status === "answered" ? applicable.map((item) => ({ text: item.claim.statement, claimIds: [item.claim._id] })) : [];
  const answer = status === "conflict" ? "The applicable sources disagree. A single answer cannot be established from this evidence."
    : status === "needs-context" ? "More context or related evidence is needed before a reliable answer can be given."
      : status === "insufficient" ? "Insufficient evidence in the Knowledge Base."
        : statements.map((statement) => statement.text).join("\n\n");
  const usedSources = new Set(evidence.map((item) => item.source._id));
  const coverage = status === "insufficient" && claims.length ? [`This collection only covers: ${[...new Set(claims.map((claim) => claim.predicate))].slice(0, 14).join("; ")}. Try a question about one of these.`] : [];
  return {
    mode, question: request.question, knowledgeBase, intent: effectiveIntent, asOf, status, answer, statements, confidence,
    confidenceReason: confidence === "high" ? "Applicable claims have primary sources and no unresolved structured conflicts. This is evidence strength, not a probability or guarantee of truth."
      : confidence === "medium" ? "The available claims support this answer, but the corpus is synthetic or includes non-primary sources."
        : confidence === "low" ? "Unresolved conflicts, missing context, or incomplete relationships prevent a definitive answer." : "No applicable supporting evidence was retrieved.",
    reasoningSummary: `${evidence.length} claims examined; ${applicable.length} applicable; ${evidence.filter((item) => item.state === "superseded").length} explicitly superseded; ${conflicts.filter((conflict) => !conflict.resolved).length} unresolved conflicts.`,
    evidence, conflicts, sources: sources.filter((source) => usedSources.has(source._id)), followUp: [...followUp, ...coverage], elapsedMs: 0,
    trace: [
      { stage: "Question interpreted", detail: intent.summary },
      { stage: "Applicability", detail: `As of ${asOf}${intent.version ? `; ${intent.version.subject} ${intent.version.value}` : ""}. Only the selected knowledge base was considered.` },
      { stage: "Relationships and conflicts", detail: `${conflicts.length} differing claim pairs; ${cycle.size} records in circular relationships.` },
      { stage: "Evidence selected", detail: `${applicable.length} applicable claims. The answer uses canonical stored claim text, not invented factual prose.` },
    ],
  };
}