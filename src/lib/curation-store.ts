import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { claimSchema, knowledgeBaseSchema, knowledgeCatalogQuery, knowledgeCatalogSchema, selectKnowledgeBase } from "./knowledge";
import { conflictCandidates, documentBudget, indexReviewState, knowledgeBaseSourceQuery, relationProblem } from "./curation";
import { RequestError } from "./http";
import { writer } from "./import-management";

const id = knowledgeBaseSchema.shape._id;
const date = z.iso.date().nullable();
const revision = z.string().min(1).max(120);
const actionContext = { knowledgeBaseId: id, expectedRevision: revision };
export const curationActionSchema = z.discriminatedUnion("action", [
  z.object({ ...actionContext, action: z.literal("add-relation"), fromId: id, toId: id, kind: z.enum(["supersedes", "corrects"]), reason: z.string().trim().min(10).max(600) }),
  z.object({ ...actionContext, action: z.literal("remove-relation"), claimId: id, key: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }),
  z.object({ ...actionContext, action: z.literal("update-claim"), claimId: id, revision, statement: z.string().trim().min(10).max(1800), value: z.string().trim().min(1).max(200), effectiveFrom: date, effectiveUntil: date }),
  z.object({ ...actionContext, action: z.literal("delete-claim"), claimId: id, revision }),
  z.object({ ...actionContext, action: z.literal("confirm-index"), confirmed: z.literal(true) }),
]);
export type CurationAction = z.infer<typeof curationActionSchema>;

const relationKeysQuery = `*[_type == "tgClaim" && knowledgeBase._ref == $id]{_id,_rev,"relations":coalesce(relations[]{_key,kind,"targetId":target._ref,reason},[])}`;
const relationKeysSchema = z.array(z.object({ _id: z.string(), _rev: z.string(), relations: z.array(z.object({ _key: z.string(), kind: z.string(), targetId: z.string(), reason: z.string() })) }));
const stateQuery = `{"catalog":${knowledgeCatalogQuery},"revision":*[_type == "tgKnowledgeBase" && _id == $id][0]._rev,"records":${relationKeysQuery}}`;
const stateSchema = z.object({ catalog: knowledgeCatalogSchema, revision: revision.nullable(), records: relationKeysSchema });

async function load(knowledgeBaseId: string, signal: AbortSignal) {
  const client = writer();
  const state = stateSchema.parse(await client.fetch(stateQuery, { id: knowledgeBaseId }, { signal }));
  if (!state.revision || !state.catalog.knowledgeBases.some((base) => base._id === knowledgeBaseId)) throw new RequestError(404, "knowledge-base-not-found", "Choose a knowledge base stored in Sanity.");
  return { client, ...state, revision: state.revision };
}

export async function curationOverview(knowledgeBaseId: string, signal: AbortSignal) {
  const { catalog, records, revision: currentRevision } = await load(knowledgeBaseId, signal);
  const selected = selectKnowledgeBase(catalog, knowledgeBaseId);
  return {
    revision: currentRevision,
    budget: documentBudget(catalog),
    indexState: indexReviewState(selected.knowledgeBase),
    sourceQuery: knowledgeBaseSourceQuery(knowledgeBaseId),
    knowledgeBase: selected.knowledgeBase,
    sources: selected.sources,
    claims: selected.claims.map((claim) => ({ ...claim, revision: records.find((item) => item._id === claim._id)!._rev })),
    conflicts: conflictCandidates(catalog, knowledgeBaseId),
    decisions: records.flatMap((item) => item.relations.filter((relation) => relation.kind === "supersedes" || relation.kind === "corrects").map((relation) => ({ claimId: item._id, ...relation }))),
  };
}

function conflictError(error: unknown, message: string): never {
  if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 409) throw new RequestError(409, "curation-conflict", message);
  throw error;
}

export async function applyCuration(action: CurationAction, signal: AbortSignal) {
  const { client, catalog, records, revision: currentRevision } = await load(action.knowledgeBaseId, signal);
  if (currentRevision !== action.expectedRevision) throw new RequestError(409, "curation-conflict", "This knowledge base changed in another session. Refresh before saving.");
  const changedAt = new Date().toISOString();
  const transaction = client.transaction().patch(action.knowledgeBaseId, (patch) => patch.ifRevisionId(currentRevision).set(action.action === "confirm-index" ? { indexReviewedAt: changedAt } : { contentChangedAt: changedAt }));
  const commit = () => transaction.commit({ visibility: "sync", signal }).catch((error: unknown) => conflictError(error, "The knowledge base changed while saving. Refresh before retrying."));
  if (action.action === "confirm-index") {
    if (!selectKnowledgeBase(catalog, action.knowledgeBaseId).knowledgeBase.mcpId) throw new RequestError(409, "mapping-required", "Verify the Knowledge Base mapping before recording an index review.");
    await commit();
    return { message: "Your index review was recorded. This is an operator confirmation, not an automatic freshness check." };
  }
  const { claims } = selectKnowledgeBase(catalog, action.knowledgeBaseId);
  const target = claims.find((claim) => claim._id === (action.action === "add-relation" ? action.fromId : action.claimId));
  if (!target) throw new RequestError(404, "claim-not-found", "The claim no longer exists in this knowledge base. Refresh and try again.");
  const record = records.find((item) => item._id === target._id)!;
  if ("revision" in action && action.revision !== record._rev) throw new RequestError(409, "curation-conflict", "This claim changed in another session. Refresh before editing or deleting it.");
  if (action.action === "add-relation") {
    const problem = relationProblem(catalog, action.knowledgeBaseId, action.fromId, action.toId);
    if (problem) throw new RequestError(409, "invalid-decision", problem);
    transaction.patch(action.fromId, (patch) => patch.ifRevisionId(record._rev).setIfMissing({ relations: [] }).append("relations", [{ _key: randomUUID(), _type: "claimRelation", kind: action.kind, target: { _type: "reference", _ref: action.toId }, reason: action.reason }]));
    await commit();
    return { message: "Decision saved in Sanity. It applies when both claims are retrieved; review the Knowledge Base entries to keep their summaries aligned." };
  }
  if (action.action === "remove-relation") {
    if (!record.relations.some((relation) => relation._key === action.key && ["supersedes", "corrects"].includes(relation.kind))) throw new RequestError(404, "decision-not-found", "The precedence decision no longer exists. Refresh before retrying.");
    transaction.patch(action.claimId, (patch) => patch.ifRevisionId(record._rev).unset([`relations[_key=="${action.key}"]`]));
    await commit();
    return { message: "Decision removed. The claims are weighed as equals again on the next investigation." };
  }
  if (action.action === "update-claim") {
    const updated = claimSchema.safeParse({ ...target, statement: action.statement, value: action.value, effectiveFrom: action.effectiveFrom, effectiveUntil: action.effectiveUntil });
    if (!updated.success) throw new RequestError(400, "invalid-claim", updated.error.issues[0]?.message || "The edited claim is invalid.");
    const source = catalog.sources.find((item) => item._id === target.sourceId)!;
    if (source.url.startsWith("urn:")) {
      const uploaded = await client.getDocument<{ _id: string; uploadedText?: string }>(source._id, { signal });
      if (!uploaded?.uploadedText?.includes(action.statement)) throw new RequestError(400, "source-mismatch", "An uploaded excerpt must remain present in the original source text.");
    }
    transaction.patch(action.claimId, (patch) => patch.ifRevisionId(record._rev).set({ statement: action.statement, value: action.value, effectiveFrom: action.effectiveFrom, effectiveUntil: action.effectiveUntil }));
    await commit();
    return { message: "Claim updated. Retrieved IDs resolve to this canonical text; rebuild or review the Knowledge Base so its summaries match." };
  }
  const inbound = claims.filter((claim) => claim.relations.some((relation) => relation.targetId === action.claimId));
  if (inbound.length) throw new RequestError(409, "claim-referenced", `Remove the decisions on ${inbound.map((claim) => claim._id).join(", ")} that point to this claim first.`);
  transaction.patch(action.claimId, (patch) => patch.ifRevisionId(record._rev).set({ statement: target.statement })).delete(action.claimId);
  await commit();
  return { message: "Claim deleted from Sanity. It is no longer used as evidence; rebuild the Knowledge Base to drop its entry text." };
}
