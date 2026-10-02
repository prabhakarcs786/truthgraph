import { appMode } from "@/lib/config";
import { getKnowledgeCatalog } from "@/lib/catalog";
import { createBudget, handleInvestigation } from "@/lib/http";
import { investigateWithContext } from "@/lib/investigator";
import { writer } from "@/lib/import-management";
import { offerInvestigationShare } from "@/lib/investigation-sharing";
import { isShowcaseRequest } from "@/lib/knowledge";
import { permitPublicInvestigation } from "@/lib/sanity-budget";
import { withShowcaseCache } from "@/lib/showcase-cache";
import { investigateSample } from "@/lib/sample-investigation";

export const runtime = "nodejs";
export const maxDuration = 60;
const permit = createBudget();
const localShowcasePermit = createBudget(12);

export async function POST(request: Request) {
  const mode = appMode();
  return handleInvestigation(request, {
    mode, accessCode: process.env.LIVE_ACCESS_CODE, permit, run: mode === "live" ? async (input, signal) => offerInvestigationShare(await withShowcaseCache(input, signal, () => investigateWithContext(input, signal))) : (input) => investigateSample(input),
    showcase: { permit: () => process.env.SANITY_WRITE_TOKEN ? permitPublicInvestigation(writer(), AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])) : localShowcasePermit(), matches: async (input) => {
      const base = (await getKnowledgeCatalog(mode, request.signal)).catalog?.knowledgeBases.find((candidate) => candidate._id === input.knowledgeBaseId);
      return Boolean(base && base.kind === "real" && isShowcaseRequest(base, input));
    } },
  });
}