import { investigationRequestSchema, investigationSchema, type Investigation, type InvestigationRequest } from "./knowledge";
import { applicationOrigin } from "./readiness";

export async function verifyLiveInvestigation(url: string, accessCode: string, input: InvestigationRequest, expectedStatus: Investigation["status"] = "answered", fetcher: typeof fetch = fetch) {
  const origin = applicationOrigin(url);
  const request = investigationRequestSchema.parse(input);
  const unauthorized = await fetcher(`${origin}/api/investigate`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(request), redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (unauthorized.status !== 401) throw new Error("The live investigation must reject unauthenticated requests. Check APP_MODE.");
  const response = await fetcher(`${origin}/api/investigate`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "x-judge-code": accessCode }, body: JSON.stringify(request), redirect: "error", signal: AbortSignal.timeout(70_000) });
  if (!response.ok) throw new Error(`The live investigation failed with HTTP ${response.status}.`);
  const result = investigationSchema.parse(await response.json());
  if (result.mode !== "live" || result.knowledgeBase.kind !== "real" || result.knowledgeBase._id !== request.knowledgeBaseId || result.question !== request.question) throw new Error("The server did not investigate the requested live knowledge base and question.");
  if (result.status !== expectedStatus) throw new Error("The result did not match the expected status for this acceptance question.");
  if (result.status === "answered" && (!result.evidence.length || !result.sources.length || !result.trace.some((step) => step.stage === "Entry retrieved"))) throw new Error("The answer does not demonstrate retrieved evidence.");
  return { question: result.question, status: result.status, claims: result.evidence.length, sources: result.sources.length };
}