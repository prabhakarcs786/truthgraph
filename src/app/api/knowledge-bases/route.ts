import { appMode } from "@/lib/config";
import { getKnowledgeCatalog } from "@/lib/catalog";
import { documentBudget } from "@/lib/curation";
import { createBudget, investigationProblem, readJson, RequestError } from "@/lib/http";
import { authorizeManagement, saveKnowledgeImport } from "@/lib/import-management";
import { preparedImportSchema } from "@/lib/knowledge-import";

export const runtime = "nodejs";
export const maxDuration = 60;
const permit = createBudget(10);

export async function GET() {
  const result = await getKnowledgeCatalog(appMode());
  if (!result.catalog) return investigationProblem(new RequestError(503, "catalog-unavailable", result.error || "Knowledge bases unavailable."));
  return Response.json({ knowledgeBases: result.catalog.knowledgeBases, budget: documentBudget(result.catalog) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    if (appMode() !== "live") throw new RequestError(409, "local-import-only", "Save sample-mode imports in this browser; they are not uploaded to the server.");
    authorizeManagement(request);
    if (!permit()) throw new RequestError(429, "import-budget", "Import budget reached. Try again in one minute.");
    const parsed = preparedImportSchema.safeParse(await readJson(request, 1_048_576));
    if (!parsed.success) throw new RequestError(400, "invalid-import", parsed.error.issues[0]?.message || "Invalid import.");
    const result = await saveKnowledgeImport(parsed.data, AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]));
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return investigationProblem(error instanceof RequestError ? error : new RequestError(502, "import-unconfirmed", "The import could not be confirmed. Refresh knowledge bases before retrying; existing records are never replaced.")); }
}