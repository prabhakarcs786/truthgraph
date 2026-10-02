import { z } from "zod";
import { appMode } from "@/lib/config";
import { authorizeInvestigation, createBudget, investigationProblem, readJson, RequestError } from "@/lib/http";
import { saveSharedInvestigation } from "@/lib/investigation-sharing";

export const runtime = "nodejs";
export const maxDuration = 30;
const permit = createBudget(20);

export async function POST(request: Request) {
  try {
    authorizeInvestigation(request, "demo");
    if (appMode() !== "live") throw new RequestError(409, "live-share-only", "Only a live Sanity investigation can be published.");
    if (!permit()) throw new RequestError(429, "share-budget", "The share request budget is exhausted. Try again shortly.");
    const body = z.object({ consent: z.literal(true), investigation: z.unknown() }).parse(await readJson(request, 524_288));
    return Response.json(await saveSharedInvestigation(body.investigation, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return investigationProblem(error instanceof z.ZodError ? new RequestError(400, "invalid-snapshot", "Explicit publication consent and a valid investigation are required.") : error); }
}