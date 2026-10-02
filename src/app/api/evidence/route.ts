import { appMode } from "@/lib/config";
import { getKnowledgeCatalog } from "@/lib/catalog";
import { authorizeInvestigation, investigationProblem, RequestError } from "@/lib/http";
import { selectKnowledgeBase } from "@/lib/knowledge";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const mode = appMode();
    authorizeInvestigation(request, "demo");
    const result = await getKnowledgeCatalog(mode, request.signal);
    if (!result.catalog) throw new RequestError(503, "catalog-unavailable", result.error || "Knowledge catalog unavailable.");
    const id = new URL(request.url).searchParams.get("knowledgeBaseId");
    if (!id || !result.catalog.knowledgeBases.some((base) => base._id === id)) throw new RequestError(400, "unknown-knowledge-base", "Choose an available knowledge base.");
    const selected = selectKnowledgeBase(result.catalog, id);
    if (mode === "live" && !(selected.knowledgeBase.kind === "real" && selected.knowledgeBase.showcase.length)) authorizeInvestigation(request, mode, process.env.LIVE_ACCESS_CODE);
    return Response.json(selected, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return investigationProblem(error); }
}