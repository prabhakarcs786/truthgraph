import { intersects } from "semver";
import { type Claim, type KnowledgeBase, type KnowledgeCatalog, selectKnowledgeBase } from "./knowledge";

/** Sanity Knowledge Bases (beta) index up to 150 documents. */
export const knowledgeBaseDocumentLimit = 150;
const replacing = new Set(["supersedes", "corrects"]);
const normalized = (value: string) => value.trim().toLowerCase();
const sameFact = (first: Claim, second: Claim) => normalized(first.subject) === normalized(second.subject) && normalized(first.predicate) === normalized(second.predicate);

export function documentBudget(catalog: KnowledgeCatalog, limit = knowledgeBaseDocumentLimit) {
  const byBase = catalog.knowledgeBases.map((base) => ({
    id: base._id, title: base.title,
    documents: 1 + catalog.sources.filter((source) => source.knowledgeBaseId === base._id).length + catalog.claims.filter((claim) => claim.knowledgeBaseId === base._id).length,
  }));
  const documents = catalog.datasetDocumentCount ?? byBase.reduce((total, base) => total + base.documents, 0);
  return { documents, limit, remaining: Math.max(0, limit - documents), byBase };
}

export function indexReviewState(base: KnowledgeBase) {
  if (!base.mcpId) return "unmapped";
  if (!base.indexReviewedAt || (base.contentChangedAt && base.contentChangedAt > base.indexReviewedAt)) return "review-required";
  return "operator-confirmed";
}

export function knowledgeBaseSourceQuery(id: string) {
  return `*[_id == ${JSON.stringify(id)} || (_type in ["tgSource", "tgClaim"] && knowledgeBase._ref == ${JSON.stringify(id)})]`;
}

function scopesOverlap(first: Claim, second: Claim) {
  if (first.version && second.version && normalized(first.version.subject) === normalized(second.version.subject) && !intersects(first.version.range, second.version.range)) return false;
  const start = [first.effectiveFrom, second.effectiveFrom].filter(Boolean).sort().at(-1);
  const end = [first.effectiveUntil, second.effectiveUntil].filter(Boolean).sort()[0];
  if (start && end && start >= end) return false;
  return !first.conditions.some((condition) => second.conditions.some((other) => normalized(other.key) === normalized(condition.key) && normalized(other.value) !== normalized(condition.value)));
}

const linked = (first: Claim, second: Claim) => [[first, second], [second, first]].some(([from, to]) => from.relations.some((relation) => replacing.has(relation.kind) && relation.targetId === to._id));

/** Exclusive claims about the same fact with different values, overlapping scope, and no recorded precedence. */
export function conflictCandidates(catalog: KnowledgeCatalog, knowledgeBaseId: string) {
  const { claims } = selectKnowledgeBase(catalog, knowledgeBaseId);
  const pairs: { claimIds: [string, string]; subject: string; predicate: string }[] = [];
  claims.forEach((first, index) => claims.slice(index + 1).forEach((second) => {
    if (first.exclusive && second.exclusive && sameFact(first, second) && normalized(first.value) !== normalized(second.value) && scopesOverlap(first, second) && !linked(first, second)) pairs.push({ claimIds: [first._id, second._id], subject: first.subject, predicate: first.predicate });
  }));
  return pairs;
}

export function relationProblem(catalog: KnowledgeCatalog, knowledgeBaseId: string, fromId: string, toId: string): string | null {
  const { claims } = selectKnowledgeBase(catalog, knowledgeBaseId);
  const from = claims.find((claim) => claim._id === fromId);
  const to = claims.find((claim) => claim._id === toId);
  if (!from || !to || from._id === to._id) return "Choose two different claims from this knowledge base.";
  if (!sameFact(from, to)) return "Precedence can only be recorded between claims about the same subject and property.";
  if (linked(from, to)) return "A precedence decision already exists between these claims.";
  if (from.relations.length >= 15) return "This claim already has the maximum number of relationships.";
  const byId = new Map(claims.map((claim) => [claim._id, claim]));
  const pending = [toId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === fromId) return "This decision would create a circular precedence chain.";
    if (seen.has(id)) continue;
    seen.add(id);
    byId.get(id)?.relations.filter((relation) => replacing.has(relation.kind)).forEach((relation) => pending.push(relation.targetId));
  }
  return null;
}
