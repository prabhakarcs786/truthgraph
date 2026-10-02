import "server-only";
import { createClient } from "@sanity/client";
import { createMCPClient } from "@ai-sdk/mcp";
import { randomUUID } from "node:crypto";
import { liveConfig } from "./config";
import { contentText } from "./grounding";
import { knowledgeBaseSchema, knowledgeCatalogQuery, knowledgeCatalogSchema } from "./knowledge";
import { mergeCatalogs, validatePreparedImport } from "./knowledge-import";
import { accessMatches, authorizeInvestigation, RequestError } from "./http";
import { documentBudget } from "./curation";
import { commitWithinDocumentBudget } from "./sanity-budget";

export function authorizeManagement(request: Request, environment: Record<string, string | undefined> = process.env) {
  authorizeInvestigation(request, "demo");
  const expected = environment.KNOWLEDGE_ADMIN_CODE;
  if (!expected || expected.length < 24 || expected === environment.LIVE_ACCESS_CODE) throw new RequestError(503, "management-not-configured", "Configure a separate KNOWLEDGE_ADMIN_CODE of at least 24 characters for knowledge-base changes.");
  if (!accessMatches(request.headers.get("x-knowledge-admin-code") || "", expected)) throw new RequestError(401, "management-access-required", "A valid knowledge-management code is required.");
}

export function writer() {
  const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
  const token = process.env.SANITY_WRITE_TOKEN;
  if (!projectId || !token) throw new RequestError(503, "import-not-configured", "Sanity project write access is not configured for imports.");
  return createClient({ projectId, dataset: process.env.SANITY_STUDIO_DATASET || "production", token, apiVersion: "2026-09-01", useCdn: false, perspective: "published", timeout: 10_000, maxRetries: 0 });
}

export async function saveKnowledgeImport(input: unknown, signal: AbortSignal) {
  const prepared = await validatePreparedImport(input).catch(() => { throw new RequestError(400, "invalid-import", "Import records, original text, and source fingerprints must be valid and consistent."); });
  const base = prepared.catalog.knowledgeBases[0];
  if (base.mcpId !== null) throw new RequestError(400, "unverified-mapping", "New imports must not contain a pre-verified MCP mapping.");
  if (base.kind !== "real") throw new RequestError(400, "synthetic-import", "Synthetic fixtures remain local; do not upload them as real challenge evidence.");
  if ([...prepared.catalog.knowledgeBases, ...prepared.catalog.sources, ...prepared.catalog.claims].some((record) => !record._id.startsWith("tg-upload-"))) throw new RequestError(400, "invalid-import-namespace", "Import identifiers must belong to a new upload namespace.");
  const client = writer();
  const current = knowledgeCatalogSchema.parse(await client.fetch(knowledgeCatalogQuery, {}, { signal }));
  let merged;
  try { merged = mergeCatalogs(current, prepared.catalog); }
  catch { throw new RequestError(409, "import-conflict", "This import duplicates existing identifiers or exceeds the catalog limits. Refresh knowledge bases before retrying."); }
  const budget = documentBudget(merged);
  if (budget.documents > budget.limit) throw new RequestError(409, "document-budget", `This import would bring the indexed dataset to ${budget.documents} documents. Sanity Knowledge Bases index up to ${budget.limit}; trim the import, or serve larger corpora through a dataset Context MCP endpoint with embeddings.`);
  try { await commitWithinDocumentBudget(client, 1 + prepared.catalog.sources.length + prepared.catalog.claims.length, (transaction) => {
  transaction.create({ ...base, _type: "tgKnowledgeBase", mcpId: null, contentChangedAt: new Date().toISOString(), indexReviewedAt: null });
  for (const { knowledgeBaseId, ...source } of prepared.catalog.sources) {
    const upload = prepared.uploads.find((item) => item.sourceId === source._id);
    transaction.create({ ...source, _type: "tgSource", knowledgeBase: { _type: "reference", _ref: knowledgeBaseId }, ...(upload ? { uploadedText: upload.text, fileName: upload.name } : {}) });
  }
  for (const { knowledgeBaseId, sourceId, conditions, relations, ...claim } of prepared.catalog.claims) transaction.create({
    ...claim, _type: "tgClaim", knowledgeBase: { _type: "reference", _ref: knowledgeBaseId }, source: { _type: "reference", _ref: sourceId },
    conditions: conditions.map((condition, index) => ({ ...condition, _key: `condition-${index}`, _type: "applicabilityCondition" })),
    relations: relations.map(({ targetId, ...relation }, index) => ({ ...relation, _key: `relation-${index}`, _type: "claimRelation", target: { _type: "reference", _ref: targetId } })),
  });
  return transaction;
  }, signal); }
  catch (error) {
    if (error instanceof RequestError) throw error;
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 409) throw new RequestError(409, "import-conflict", "An import with these identifiers already exists. No existing records were replaced.");
    throw error;
  }
  return { knowledgeBase: base, state: "awaiting-index" as const, records: 1 + prepared.catalog.sources.length + prepared.catalog.claims.length };
}

async function verifyMcpMapping(mcpId: string, signal: AbortSignal) {
  const config = liveConfig();
  const url = new URL(config.mcpUrl);
  url.searchParams.set("mode", "knowledge_base"); url.searchParams.set("knowledgeBases", mcpId);
  const client = await createMCPClient({ initializationOptions: { signal, timeout: 10_000 }, transport: { type: "http", url: url.toString(), headers: { Authorization: `Bearer ${config.organizationToken}` }, fetch: (input, options) => fetch(input, { ...options, signal, redirect: "error" }) } });
  try {
    const tools = await client.tools();
    if (!tools.initial_context?.execute || !tools.knowledge_base_read?.execute) throw new Error("Knowledge Base tools missing");
    const output = await tools.initial_context.execute({}, { toolCallId: randomUUID(), messages: [], abortSignal: signal });
    if (!contentText(output).includes(mcpId)) throw new Error("The selected Knowledge Base was not present in the verified outline");
  } finally { await client.close().catch(() => undefined); }
}

export async function mapKnowledgeBase(id: string, mcpId: string, expectedMcpId: string | null, signal: AbortSignal) {
  knowledgeBaseSchema.shape._id.parse(id);
  const parsedMcpId = knowledgeBaseSchema.shape.mcpId.unwrap().parse(mcpId);
  const client = writer();
  const document = await client.getDocument<{ _id: string; _rev: string; _type: string; mcpId?: string | null }>(id, { signal });
  if (!document || document._type !== "tgKnowledgeBase") throw new RequestError(404, "knowledge-base-not-found", "The knowledge base no longer exists.");
  if ((document.mcpId || null) !== expectedMcpId) throw new RequestError(409, "mapping-conflict", "The mapping changed in another session. Refresh before saving.");
  await verifyMcpMapping(parsedMcpId, signal);
  try {
    const updated = await client.patch(id).ifRevisionId(document._rev).set({ mcpId: parsedMcpId }).commit({ visibility: "sync", signal });
    // Stored tour scenarios omit an empty asOf; the API shape requires null.
    const showcase = ((updated as { showcase?: { asOf?: string | null }[] }).showcase ?? []).map((scenario) => ({ ...scenario, asOf: scenario.asOf ?? null }));
    return { knowledgeBase: knowledgeBaseSchema.parse({ ...updated, showcase }), state: "outline-verified" as const };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 409) throw new RequestError(409, "mapping-conflict", "The knowledge base changed during verification. Refresh and try again.");
    throw error;
  }
}