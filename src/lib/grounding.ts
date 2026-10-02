import { z } from "zod";
import { retrievalPlanSchema, type InvestigationRequest, type KnowledgeCatalog, type RetrievalPlan, selectKnowledgeBase } from "./knowledge";

export type RetrievedEntry = { knowledgeBase: string; paths: string[]; text: string };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const citesClaim = (text: string, id: string) => new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`).test(text);

export function contentText(output: unknown): string {
  if (output && typeof output === "object" && "isError" in output && output.isError === true) throw new Error("Sanity returned a tool error instead of evidence.");
  const strings: string[] = [];
  let size = 0;
  function collect(value: unknown, depth: number) {
    if (depth > 12 || size > 250_000) throw new Error("Retrieved content exceeds the evidence budget.");
    if (typeof value === "string") { size += value.length; strings.push(value); }
    else if (Array.isArray(value)) value.forEach((item) => collect(item, depth + 1));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => collect(item, depth + 1));
  }
  collect(output, 0);
  if (size > 250_000) throw new Error("Retrieved content exceeds the evidence budget.");
  return strings.join("\n");
}

export function groundPlan(input: unknown, entries: RetrievedEntry[], request: InvestigationRequest, catalog: KnowledgeCatalog): RetrievalPlan & { ignoredIds: string[] } {
  const plan = retrievalPlanSchema.parse(input);
  const { knowledgeBase, claims } = selectKnowledgeBase(catalog, request.knowledgeBaseId);
  if (new Set(plan.claimIds).size !== plan.claimIds.length) throw new Error("Duplicate claim IDs in model output.");
  const statedDate = request.question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (request.asOf) plan.intent.asOf = request.asOf;
  else if (statedDate && z.iso.date().safeParse(statedDate).success) plan.intent.asOf = statedDate;
  else if (plan.intent.asOf && !request.question.includes(plan.intent.asOf.slice(0, 4))) plan.intent.asOf = null;
  // Like dates, a condition counts only when the question mentions it; models tend to fill in a plausible one.
  const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && /[a-z]/.test(word));
  const asked = words(request.question);
  plan.intent.conditions = plan.intent.conditions.filter((condition) => words(condition.value).some((value) => asked.some((word) => word === value || word.startsWith(value) || value.startsWith(word))));
  // Synthesized entries do not show stored field names, so filters that name no stored subject or predicate are ignored rather than allowed to drop cited claims.
  const stored = (values: string[]) => new Set(values.map((value) => value.trim().toLowerCase()));
  const subjects = stored(claims.map((claim) => claim.subject));
  const predicates = stored(claims.map((claim) => claim.predicate));
  plan.intent.subjects = plan.intent.subjects.filter((subject) => subjects.has(subject.trim().toLowerCase()));
  plan.intent.predicates = plan.intent.predicates.filter((predicate) => predicates.has(predicate.trim().toLowerCase()));
  const ignoredIds = plan.claimIds.filter((id) => !claims.some((candidate) => candidate._id === id));
  for (const id of ignoredIds) {
    if (!entries.some((entry) => entry.knowledgeBase === knowledgeBase.mcpId && citesClaim(entry.text, id))) throw new Error("A selected claim is not part of the configured knowledge base or retrieved entries.");
  }
  plan.claimIds = plan.claimIds.filter((id) => !ignoredIds.includes(id));
  for (const id of plan.claimIds) {
    const claim = claims.find((candidate) => candidate._id === id)!;
    // Context entries are synthesized summaries that cite source records by ID; the canonical statement and URL come from Content Lake.
    const proof = entries.some((entry) => entry.knowledgeBase === knowledgeBase.mcpId && citesClaim(entry.text, claim._id));
    if (!proof) throw new Error("A cited claim was not found in a retrieved Knowledge Base entry, or the Knowledge Base is stale. Rebuild it from the current source records.");
  }
  // Alternatives for the same fact that a retrieved entry also cites must be weighed, not reported as missing.
  const sameFact = (first: (typeof claims)[number], second: (typeof claims)[number]) => first.subject.trim().toLowerCase() === second.subject.trim().toLowerCase() && first.predicate.trim().toLowerCase() === second.predicate.trim().toLowerCase();
  const selected = claims.filter((claim) => plan.claimIds.includes(claim._id));
  for (const peer of claims) {
    if (plan.claimIds.includes(peer._id) || !selected.some((claim) => sameFact(claim, peer))) continue;
    if (entries.some((entry) => entry.knowledgeBase === knowledgeBase.mcpId && citesClaim(entry.text, peer._id))) plan.claimIds.push(peer._id);
  }
  return { ...plan, ignoredIds };
}