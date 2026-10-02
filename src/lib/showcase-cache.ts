import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@sanity/client";
import { z } from "zod";
import { getKnowledgeCatalog } from "./catalog";
import { writer } from "./import-management";
import { investigationSchema, isShowcaseRequest, selectKnowledgeBase, type Investigation, type InvestigationRequest } from "./knowledge";

const cacheSchema = z.object({ fingerprint: z.string(), recordedAt: z.iso.datetime(), result: z.string() });
const reader = () => process.env.SANITY_WRITE_TOKEN ? writer() : createClient({ projectId: process.env.SANITY_STUDIO_PROJECT_ID, dataset: process.env.SANITY_STUDIO_DATASET || "production", apiVersion: "2026-09-01", useCdn: false, token: process.env.SANITY_READ_TOKEN, perspective: "published", timeout: 8000, maxRetries: 0 });

/** Reuses a recorded live showcase run while the question, the corpus's canonical records, and which claims are in effect today are unchanged. */
export async function withShowcaseCache(input: InvestigationRequest, signal: AbortSignal, compute: () => Promise<Investigation>, today = new Date().toISOString().slice(0, 10)): Promise<Investigation> {
  if (!process.env.SANITY_STUDIO_PROJECT_ID) return compute();
  const { catalog } = await getKnowledgeCatalog("live", signal);
  const base = catalog?.knowledgeBases.find((candidate) => candidate._id === input.knowledgeBaseId);
  if (!catalog || !base || base.kind !== "real" || !isShowcaseRequest(base, input)) return compute();
  const { sources, claims } = selectKnowledgeBase(catalog, base._id);
  const inEffect = claims.map((claim) => [claim._id, (!claim.effectiveFrom || claim.effectiveFrom <= today) && (!claim.effectiveUntil || today < claim.effectiveUntil)]);
  const fingerprint = createHash("sha256").update(JSON.stringify({ question: input.question.trim(), asOf: input.asOf || null, inEffect, base, sources, claims })).digest("hex");
  const id = `tg-showcase-${createHash("sha256").update(`${base._id}\u0000${input.question.trim()}\u0000${input.asOf || ""}`).digest("hex").slice(0, 32)}`;
  const cached = cacheSchema.safeParse(await reader().getDocument(id, { signal }).catch(() => null));
  if (cached.success && cached.data.fingerprint === fingerprint) {
    const result = investigationSchema.parse(JSON.parse(cached.data.result));
    result.trace.unshift({ stage: "Recorded live run", detail: `Reused the Sanity Context investigation recorded at ${cached.data.recordedAt}. The question, every canonical record in this corpus, and which claims are in effect today are unchanged since then.` });
    return result;
  }
  const result = await compute();
  if (process.env.SANITY_WRITE_TOKEN) await writer().createOrReplace({ _id: id, _type: "tgShowcaseCache", fingerprint, recordedAt: new Date().toISOString(), result: JSON.stringify(result) }, { signal }).catch(() => undefined);
  return result;
}
