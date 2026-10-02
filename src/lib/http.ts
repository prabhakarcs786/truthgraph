import { createHash, timingSafeEqual } from "node:crypto";
import { investigationRequestSchema, investigationSchema, type InvestigationRequest, type Investigation } from "./knowledge";

export function authorizeInvestigation(request: Request, mode: "demo" | "live", accessCode?: string, permit?: () => boolean) {
  const origin = request.headers.get("origin");
  if (origin) {
    let accepted: boolean;
    try { const parsed = new URL(origin); accepted = ["http:", "https:"].includes(parsed.protocol) && parsed.origin === origin && parsed.host === (request.headers.get("host") || new URL(request.url).host); } catch { accepted = false; }
    if (!accepted) throw new RequestError(403, "origin-rejected", "Cross-origin requests are not allowed.");
  }
  if (mode === "live") {
    if (!accessCode) throw new RequestError(503, "live-not-configured", "Live access has not been configured.");
    if (!accessMatches(request.headers.get("x-judge-code") || "", accessCode)) throw new RequestError(401, "access-required", "A valid access code is required.");
    if (permit && !permit()) throw new RequestError(429, "budget-exceeded", "The request budget is exhausted. Try again in one minute.");
  }
}

export function investigationProblem(cause: unknown): Response {
  let error = cause;
  if (!(cause instanceof RequestError)) {
    const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    console.error("investigation failed:", message.slice(0, 400));
    if (/high demand|overloaded|unavailable|rate.?limit|quota|resource.?exhausted|\b(429|503)\b/i.test(message)) error = new RequestError(503, "provider-busy", "The model provider is busy. Retry in a few seconds; no answer was substituted.");
  }
  const known = error instanceof RequestError ? error : null;
  const status = known ? known.status : 502;
  return Response.json({ type: "about:blank", title: known ? known.message : "The investigation could not verify its evidence. Check the selected Knowledge Base, current source records, and provider access. No sample answer was substituted.", status, code: known ? known.code : "investigation-failed" }, { status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : status === 503 ? { "Retry-After": "10" } : {}) } });
}

export async function handleInvestigation(request: Request, options: {
  mode: "demo" | "live"; accessCode?: string; permit?: () => boolean;
  showcase?: { permit: () => boolean | Promise<boolean>; matches: (input: InvestigationRequest) => boolean | Promise<boolean> };
  run: (input: InvestigationRequest, signal: AbortSignal) => Investigation | Promise<Investigation>;
}) {
  try {
    authorizeInvestigation(request, "demo");
    const parsed = investigationRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new RequestError(400, "invalid-question", parsed.error.issues[0]?.message || "The question is invalid.");
    // Curated showcase questions run without a code under their own budget; anything else needs the access code.
    if (options.mode === "live" && !request.headers.get("x-judge-code") && options.showcase && await options.showcase.matches(parsed.data)) {
      if (!await options.showcase.permit()) throw new RequestError(429, "budget-exceeded", "The public demo minute or daily budget is exhausted. Use an access code or try later.");
    } else authorizeInvestigation(request, options.mode, options.accessCode, options.permit);
    const result = investigationSchema.parse(await options.run(parsed.data, request.signal));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return investigationProblem(error); }
}

export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function readJson(request: Request, maxBytes = 8192): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new RequestError(415, "unsupported-media-type", "Send JSON with Content-Type application/json.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "invalid-json", "A JSON request body is required.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestError(413, "payload-too-large", "The request is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RequestError(400, "invalid-json", "The request body is not valid JSON."); }
}

export function accessMatches(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return Boolean(expected) && timingSafeEqual(digest(provided), digest(expected));
}

export function createBudget(limit = 20, now = Date.now) {
  let startedAt = now();
  let used = 0;
  return () => {
    if (now() - startedAt >= 60_000) { startedAt = now(); used = 0; }
    used += 1;
    return used <= limit;
  };
}
