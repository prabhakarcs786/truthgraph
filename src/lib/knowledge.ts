import { validRange } from "semver";
import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).max(120);
const date = z.iso.date();
const nullableDate = date.nullable();

export const knowledgeBaseSchema = z.object({
  _id: identifier,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  kind: z.enum(["real", "synthetic"]),
  mcpId: z.string().regex(/^kb[a-zA-Z0-9_-]+$/).nullable(),
  contentChangedAt: z.iso.datetime().nullable().optional(),
  indexReviewedAt: z.iso.datetime().nullable().optional(),
  suggestedQuestions: z.array(z.string().min(5).max(500)).max(8),
  showcase: z.array(z.object({ title: z.string().min(3).max(80), question: z.string().min(5).max(500), asOf: nullableDate, lesson: z.string().min(10).max(400) })).max(8).default([]),
});

export function isShowcaseRequest(base: Pick<KnowledgeBase, "showcase">, request: { question: string; asOf?: string }) {
  return base.showcase.some((scenario) => scenario.question === request.question.trim() && (scenario.asOf || "") === (request.asOf || ""));
}

export const knowledgeSourceSchema = z.object({
  _id: identifier,
  knowledgeBaseId: identifier,
  title: z.string().min(1).max(200),
  publisher: z.string().min(1).max(120),
  url: z.string().max(2048).refine((value) => {
    if (/^urn:sha256:[a-f0-9]{64}$/.test(value)) return true;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  }, "Sources must use HTTPS or a content-addressed upload identifier."),
  fileName: z.string().max(180).optional(),
  authority: z.enum(["primary", "secondary", "unverified"]),
  publishedAt: nullableDate,
  reviewedAt: date,
});

export const conditionSchema = z.object({ key: z.string().min(1).max(80), value: z.string().min(1).max(120) });
export const claimSchema = z.object({
  _id: identifier,
  knowledgeBaseId: identifier,
  sourceId: identifier,
  subject: z.string().min(1).max(120),
  predicate: z.string().min(1).max(120),
  value: z.string().min(1).max(200),
  statement: z.string().min(10).max(1800),
  aliases: z.array(z.string().min(1).max(80)).max(20),
  exclusive: z.boolean(),
  version: z.object({ subject: z.string().min(1).max(120), aliases: z.array(z.string().min(1).max(80)).max(6).optional(), range: z.string().max(120).refine((value) => Boolean(validRange(value)), "Use a valid semantic version range.") }).nullable(),
  effectiveFrom: nullableDate,
  effectiveUntil: nullableDate,
  conditions: z.array(conditionSchema).max(10),
  relations: z.array(z.object({ kind: z.enum(["supersedes", "corrects", "supports", "related"]), targetId: identifier, reason: z.string().min(10).max(600) })).max(15),
}).refine((claim) => !claim.effectiveFrom || !claim.effectiveUntil || claim.effectiveFrom < claim.effectiveUntil, "Effective-until must be later than effective-from.");

export const knowledgeCatalogSchema = z.object({
  knowledgeBases: z.array(knowledgeBaseSchema).max(20),
  // Merged views include private browser imports; the 150-document index budget is enforced by documentBudget.
  sources: z.array(knowledgeSourceSchema).max(1000),
  claims: z.array(claimSchema).max(1000),
  datasetDocumentCount: z.number().int().nonnegative().optional(),
}).superRefine((catalog, context) => {
  const allIds = [...catalog.knowledgeBases, ...catalog.sources, ...catalog.claims].map((record) => record._id);
  if (new Set(allIds).size !== allIds.length) context.addIssue({ code: "custom", message: "Record IDs must be unique." });
  const bases = new Set(catalog.knowledgeBases.map((base) => base._id));
  const sources = new Map(catalog.sources.map((source) => [source._id, source]));
  const claims = new Map(catalog.claims.map((claim) => [claim._id, claim]));
  for (const source of catalog.sources) if (!bases.has(source.knowledgeBaseId)) context.addIssue({ code: "custom", message: "A source references an unknown knowledge base." });
  for (const claim of catalog.claims) {
    if (!bases.has(claim.knowledgeBaseId) || sources.get(claim.sourceId)?.knowledgeBaseId !== claim.knowledgeBaseId) context.addIssue({ code: "custom", message: "Claims and their sources must belong to the same knowledge base." });
    for (const relation of claim.relations) {
      if (relation.targetId === claim._id || claims.get(relation.targetId)?.knowledgeBaseId !== claim.knowledgeBaseId) context.addIssue({ code: "custom", message: "Relationships require another claim in the same knowledge base." });
    }
  }
});

export const investigationRequestSchema = z.object({
  knowledgeBaseId: identifier,
  question: z.string().trim().min(5).max(2000),
  asOf: date.optional(),
});

export const intentSchema = z.object({
  summary: z.string().min(1).max(500),
  subjects: z.array(z.string().min(1).max(120)).max(10),
  predicates: z.array(z.string().min(1).max(120)).max(10),
  asOf: nullableDate,
  version: z.object({ subject: z.string().min(1).max(120), value: z.string().max(120).refine((value) => Boolean(validRange(value))) }).nullable(),
  conditions: z.array(conditionSchema).max(10),
});

export const retrievalPlanSchema = z.object({ intent: intentSchema, claimIds: z.array(identifier).max(60) });
export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type KnowledgeCatalog = z.infer<typeof knowledgeCatalogSchema>;
export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type RetrievalPlan = z.infer<typeof retrievalPlanSchema>;
export type EvidenceState = "applicable" | "superseded" | "out-of-scope" | "not-yet-effective" | "expired" | "needs-context" | "unresolved";
export type EvidenceItem = { claim: Claim; source: KnowledgeSource; state: EvidenceState; reasons: string[]; replacedBy: string[] };
export type Conflict = { claimIds: string[]; resolved: boolean; resolution: string | null; resolutionClaimIds: string[] };
export const baselineVerdicts = ["agrees", "outdated", "wrong-scope", "wrong-date", "missing-context", "hides-conflict", "unrelated", "no-match"] as const;
export const baselineSchema = z.object({
  method: z.literal("keyword-top-hit"),
  claimId: identifier.nullable(),
  statement: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  verdict: z.enum(baselineVerdicts),
  explanation: z.string(),
});
export type Baseline = z.infer<typeof baselineSchema>;
export const shareReceiptSchema = z.object({ id: z.uuid(), issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), signature: z.string().regex(/^[a-f0-9]{64}$/) });
export type Investigation = {
  mode: "sample" | "live" | "upload";
  question: string;
  knowledgeBase: KnowledgeBase;
  intent: Intent;
  asOf: string;
  status: "answered" | "conflict" | "needs-context" | "insufficient";
  answer: string;
  statements: { text: string; claimIds: string[] }[];
  confidence: "high" | "medium" | "low" | "insufficient";
  confidenceReason: string;
  reasoningSummary: string;
  evidence: EvidenceItem[];
  conflicts: Conflict[];
  sources: KnowledgeSource[];
  followUp: string[];
  trace: { stage: string; detail: string }[];
  elapsedMs: number;
  baseline?: Baseline;
  shareReceipt?: z.infer<typeof shareReceiptSchema>;
};

export const investigationSchema: z.ZodType<Investigation> = z.object({
  mode: z.enum(["sample", "live", "upload"]), question: z.string(), knowledgeBase: knowledgeBaseSchema, intent: intentSchema, asOf: date,
  status: z.enum(["answered", "conflict", "needs-context", "insufficient"]), answer: z.string(),
  statements: z.array(z.object({ text: z.string(), claimIds: z.array(identifier).min(1) })),
  confidence: z.enum(["high", "medium", "low", "insufficient"]), confidenceReason: z.string(), reasoningSummary: z.string(),
  evidence: z.array(z.object({ claim: claimSchema, source: knowledgeSourceSchema, state: z.enum(["applicable", "superseded", "out-of-scope", "not-yet-effective", "expired", "needs-context", "unresolved"]), reasons: z.array(z.string()), replacedBy: z.array(identifier) })),
  conflicts: z.array(z.object({ claimIds: z.array(identifier).min(2), resolved: z.boolean(), resolution: z.string().nullable(), resolutionClaimIds: z.array(identifier) })),
  sources: z.array(knowledgeSourceSchema), followUp: z.array(z.string()), trace: z.array(z.object({ stage: z.string(), detail: z.string() })), elapsedMs: z.number().min(0),
  baseline: baselineSchema.optional(),
  shareReceipt: shareReceiptSchema.optional(),
}).superRefine((result, context) => {
  for (const statement of result.statements) for (const id of statement.claimIds) {
    const item = result.evidence.find((evidence) => evidence.claim._id === id);
    if (!item || item.state !== "applicable" || item.claim.statement !== statement.text) context.addIssue({ code: "custom", message: "Answer statements must match cited applicable evidence." });
  }
});

export const knowledgeCatalogQuery = `{
  "datasetDocumentCount": count(*[!(_id in path("drafts.**")) && !(_id in path("versions.**")) && !(_id in path("_.**"))]),
  "knowledgeBases": *[_type == "tgKnowledgeBase"] | order(coalesce(sortOrder, 100) asc, title asc)[0...21]{_id,title,description,kind,"mcpId":coalesce(mcpId,null),"contentChangedAt":coalesce(contentChangedAt,null),"indexReviewedAt":coalesce(indexReviewedAt,null),"suggestedQuestions":coalesce(suggestedQuestions,[]),"showcase":coalesce(showcase[]{title,question,"asOf":coalesce(asOf,null),lesson},[])},
  "sources": *[_type == "tgSource"][0...151]{_id,"knowledgeBaseId":knowledgeBase._ref,title,publisher,url,"fileName":coalesce(fileName,""),authority,"publishedAt":coalesce(publishedAt,null),reviewedAt},
  "claims": *[_type == "tgClaim"][0...151]{_id,"knowledgeBaseId":knowledgeBase._ref,"sourceId":source._ref,subject,predicate,value,statement,"aliases":coalesce(aliases,[]),exclusive,"version":select(defined(version.range)=>version,null),"effectiveFrom":coalesce(effectiveFrom,null),"effectiveUntil":coalesce(effectiveUntil,null),"conditions":coalesce(conditions,[]),"relations":coalesce(relations[]{kind,"targetId":target._ref,reason},[])}
}`;

export function selectKnowledgeBase(catalog: KnowledgeCatalog, id: string) {
  const knowledgeBase = catalog.knowledgeBases.find((candidate) => candidate._id === id);
  if (!knowledgeBase) throw new Error("Unknown knowledge base.");
  return { knowledgeBase, sources: catalog.sources.filter((source) => source.knowledgeBaseId === id), claims: catalog.claims.filter((claim) => claim.knowledgeBaseId === id) };
}