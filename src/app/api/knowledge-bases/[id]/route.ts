import { z } from "zod";
import { appMode } from "@/lib/config";
import { createBudget, investigationProblem, readJson, RequestError } from "@/lib/http";
import { authorizeManagement, mapKnowledgeBase } from "@/lib/import-management";
import { knowledgeBaseSchema } from "@/lib/knowledge";

export const runtime = "nodejs";
export const maxDuration = 60;
const permit = createBudget(10);
const mappingSchema = z.object({ mcpId: knowledgeBaseSchema.shape.mcpId.unwrap(), expectedMcpId: knowledgeBaseSchema.shape.mcpId });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (appMode() !== "live") throw new RequestError(409, "local-import-only", "Local imports do not have Sanity MCP mappings.");
    authorizeManagement(request);
    if (!permit()) throw new RequestError(429, "mapping-budget", "Mapping verification budget reached. Try again in one minute.");
    const parsed = mappingSchema.safeParse(await readJson(request));
    const id = knowledgeBaseSchema.shape._id.safeParse((await context.params).id);
    if (!parsed.success || !id.success) throw new RequestError(400, "invalid-mapping", "Enter a valid knowledge base and kb... identifier.");
    return Response.json(await mapKnowledgeBase(id.data, parsed.data.mcpId, parsed.data.expectedMcpId, AbortSignal.any([request.signal, AbortSignal.timeout(25_000)])), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return investigationProblem(error instanceof RequestError ? error : new RequestError(502, "mapping-unconfirmed", "The mapping could not be verified or saved. Refresh knowledge bases and check the endpoint's Knowledge Base access before retrying.")); }
}