import "server-only";
import { randomUUID } from "node:crypto";
import { type SanityClient, type Transaction } from "@sanity/client";
import { z } from "zod";
import { knowledgeBaseDocumentLimit } from "./curation";
import { RequestError } from "./http";

const stateId = "tg-runtime-budget";
const stateType = "tgRuntimeBudget";
const snapshotQuery = `{"revision":*[_id == "${stateId}"][0]._rev,"documents":count(*[!(_id in path("drafts.**")) && !(_id in path("versions.**")) && !(_id in path("_.**"))])}`;
const budgetSchema = z.object({ revision: z.string(), documents: z.number().int().nonnegative() });
const conflict = (error: unknown) => Boolean(error && typeof error === "object" && "statusCode" in error && error.statusCode === 409);

export async function commitWithinDocumentBudget(client: SanityClient, additions: number, build: (transaction: Transaction) => Transaction, signal: AbortSignal) {
  await client.createIfNotExists({ _id: stateId, _type: stateType }, { visibility: "sync", signal });
  const budget = budgetSchema.parse(await client.fetch(snapshotQuery, {}, { signal }));
  if (budget.documents + additions > knowledgeBaseDocumentLimit) throw new RequestError(409, "document-budget", `This save would use ${budget.documents + additions}/${knowledgeBaseDocumentLimit} project documents. Remove unused records or use a separately configured dataset Context MCP endpoint with embeddings for a larger corpus.`);
  const transaction = client.transaction().patch(stateId, (patch) => patch.ifRevisionId(budget.revision).set({ allocation: randomUUID() }));
  try { await build(transaction).commit({ visibility: "sync", signal }); }
  catch (error) {
    if (conflict(error)) throw new RequestError(409, "write-conflict", "Another save changed the document budget. Refresh before retrying; no partial records were saved.");
    throw error;
  }
}

type PublicBudget = { _id: string; _rev: string; minute?: number; minuteUsed?: number; day?: number; dayUsed?: number };

export async function permitPublicInvestigation(client: SanityClient, signal: AbortSignal, now = Date.now()) {
  await client.createIfNotExists({ _id: stateId, _type: stateType }, { visibility: "sync", signal });
  const minute = Math.floor(now / 60_000);
  const day = Math.floor(now / 86_400_000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await client.getDocument<PublicBudget>(stateId, { signal });
    if (!state?._rev) throw new RequestError(503, "public-budget-unavailable", "The public demo budget is unavailable. Use an access code or try again later.");
    const minuteUsed = state.minute === minute ? state.minuteUsed ?? 0 : 0;
    const dayUsed = state.day === day ? state.dayUsed ?? 0 : 0;
    if (minuteUsed >= 12 || dayUsed >= 100) return false;
    try {
      await client.patch(stateId).ifRevisionId(state._rev).set({ minute, minuteUsed: minuteUsed + 1, day, dayUsed: dayUsed + 1 }).commit({ visibility: "sync", signal });
      return true;
    } catch (error) { if (!conflict(error)) throw error; }
  }
  throw new RequestError(503, "public-budget-busy", "The public demo is busy. Retry shortly or use an access code.");
}