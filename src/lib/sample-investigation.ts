import { validRange } from "semver";
import { intentSchema, type InvestigationRequest, type KnowledgeCatalog, type RetrievalPlan, selectKnowledgeBase } from "./knowledge";
import { sampleCatalog } from "./sample-data";
import { reasonOverEvidence } from "./reasoning";
import { compareWithBaseline } from "./baseline";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const stopWords = new Set("a an the what which is are was were does do can could should how when why in on for of to and or with it me tell explain only about use my this that currently now version please".split(" "));

export function selectSampleEvidence(request: InvestigationRequest, catalog: KnowledgeCatalog = sampleCatalog): RetrievalPlan {
  const { claims } = selectKnowledgeBase(catalog, request.knowledgeBaseId);
  const question = ` ${text(request.question)} `;
  const scored = claims.map((claim) => {
    const aliases = claim.aliases.filter((alias) => question.includes(` ${text(alias)} `));
    const tokens = text(claim.predicate).split(" ").filter((token) => token.length > 2 && !stopWords.has(token));
    const excerptTerms = claim.predicate.startsWith("Document excerpt ") ? [...new Set(text(claim.statement).split(" ").filter((token) => token.length > 2 && !stopWords.has(token)))] : [];
    const score = aliases.reduce((total, alias) => total + text(alias).split(" ").length * 4, 0) + tokens.filter((token) => question.includes(` ${token} `)).length + excerptTerms.filter((token) => question.includes(` ${token} `)).length;
    return { claim, score };
  });
  const maximum = Math.max(0, ...scored.map((item) => item.score));
  const matched = scored.filter((item) => item.score > 0 && item.score >= maximum * .65).map((item) => item.claim);
  const groups = new Set(matched.map((claim) => `${claim.subject}\u0000${claim.predicate}`));
  const relevant = claims.filter((claim) => groups.has(`${claim.subject}\u0000${claim.predicate}`));
  let version: RetrievalPlan["intent"]["version"] = null;
  for (const claim of relevant) {
    if (!claim.version) continue;
    for (const name of [claim.version.subject, ...(claim.version.aliases || [])]) {
      const pattern = new RegExp(`\\b${escape(name)}\\s*(?:version\\s*|v\\s*)?(\\d+(?:\\.\\d+){0,2}(?:-[a-z0-9.-]+)?)\\b`, "i");
      const value = request.question.match(pattern)?.[1];
      if (value && validRange(value)) version = { subject: claim.version.subject, value };
    }
  }
  const possibleDate = request.question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const conditions = relevant.flatMap((claim) => claim.conditions).filter((condition, index, all) => new RegExp(`\\b(?:${escape(condition.key)}\\s*[:=]?\\s*)?${escape(condition.value)}\\b`, "i").test(request.question) && all.findIndex((other) => other.key === condition.key && new RegExp(`\\b${escape(other.value)}\\b`, "i").test(request.question)) === index);
  const intent = intentSchema.parse({ summary: relevant.length ? `Investigate ${[...new Set(relevant.map((claim) => claim.predicate))].join(", ")}.` : "No matching claim topic was found in this sample corpus.", subjects: [...new Set(relevant.map((claim) => claim.subject))], predicates: [...new Set(relevant.map((claim) => claim.predicate))], asOf: request.asOf || possibleDate || null, version, conditions });
  return { intent, claimIds: relevant.map((claim) => claim._id) };
}

export function investigateSample(request: InvestigationRequest) {
  return investigateLocally(request, sampleCatalog);
}

export function investigateLocally(request: InvestigationRequest, catalog: KnowledgeCatalog) {
  const startedAt = Date.now();
  const plan = selectSampleEvidence(request, catalog);
  const result = reasonOverEvidence(request, plan.intent, plan.claimIds, catalog, "sample");
  result.baseline = compareWithBaseline(request, plan.intent, plan.claimIds, catalog, result);
  result.trace.unshift({ stage: "Sample retrieval", detail: "Local, corpus-driven token matching selected these claims. No model, Sanity, or MCP call was made. This is not a live agent run." });
  result.elapsedMs = Date.now() - startedAt;
  return result;
}