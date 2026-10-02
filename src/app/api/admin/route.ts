import { appMode } from "@/lib/config";
import { applyCuration, curationActionSchema, curationOverview } from "@/lib/curation-store";
import { createBudget, investigationProblem, readJson, RequestError } from "@/lib/http";
import { authorizeManagement } from "@/lib/import-management";
import { knowledgeBaseSchema } from "@/lib/knowledge";

export const runtime = "nodejs";
export const maxDuration = 30;
const permit = createBudget(30);

function requireLiveAdmin(request: Request) {
  if (appMode() !== "live") throw new RequestError(409, "curation-live-only", "Curation writes to Sanity and is available in live mode only.");
  authorizeManagement(request);
  if (!permit()) throw new RequestError(429, "curation-budget", "Curation budget reached. Try again in one minute.");
}

const failure = (error: unknown) => investigationProblem(error instanceof RequestError ? error : new RequestError(502, "curation-unconfirmed", "Sanity did not confirm the change. Refresh before retrying."));

export async function GET(request: Request) {
  try {
    requireLiveAdmin(request);
    const id = knowledgeBaseSchema.shape._id.safeParse(new URL(request.url).searchParams.get("knowledgeBaseId"));
    if (!id.success) throw new RequestError(400, "unknown-knowledge-base", "Choose a knowledge base.");
    return Response.json(await curationOverview(id.data, AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireLiveAdmin(request);
    const parsed = curationActionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new RequestError(400, "invalid-curation", parsed.error.issues[0]?.message || "Invalid curation request.");
    return Response.json(await applyCuration(parsed.data, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
