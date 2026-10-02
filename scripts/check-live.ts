import { createMCPClient } from "@ai-sdk/mcp";
import { createClient } from "@sanity/client";
import { liveConfig } from "../src/lib/config";
import { inspectConfiguration } from "../src/lib/readiness";
import { knowledgeCatalogQuery, knowledgeCatalogSchema, selectKnowledgeBase } from "../src/lib/knowledge";
import { verifyLiveInvestigation } from "../src/lib/live-investigation-check";

async function check() {
  const readiness = inspectConfiguration();
  if (!readiness.configured) {
    console.error(JSON.stringify(readiness, null, 2));
    throw new Error("Live configuration is incomplete");
  }
  const config = liveConfig();
  const catalog = createClient({ projectId: config.projectId, dataset: config.dataset, apiVersion: "2026-09-01", token: process.env.SANITY_READ_TOKEN, useCdn: false, perspective: "published", timeout: 10_000, maxRetries: 0 });
  const content = knowledgeCatalogSchema.parse(await catalog.fetch(knowledgeCatalogQuery, {}, { signal: AbortSignal.timeout(10_000) }));
  const realBases = content.knowledgeBases.filter((base) => base.kind === "real");
  const recordId = process.env.KNOWLEDGE_BASE_RECORD_ID || (realBases.length === 1 ? realBases[0]._id : "");
  const selected = selectKnowledgeBase(content, recordId);
  if (!selected.knowledgeBase.mcpId || !selected.claims.length) throw new Error("Configure the selected Knowledge Base's MCP ID and content first");
  console.log(`Content Lake preflight passed: ${selected.sources.length} sources and ${selected.claims.length} claims in ${selected.knowledgeBase.title}.`);
  const url = new URL(config.mcpUrl);
  url.searchParams.set("mode", "knowledge_base");
  url.searchParams.set("knowledgeBases", selected.knowledgeBase.mcpId);
  const signal = AbortSignal.timeout(15_000);
  const client = await createMCPClient({ transport: { type: "http", url: url.toString(), headers: { Authorization: `Bearer ${config.organizationToken}` }, fetch: (input, init) => fetch(input, { ...init, signal, redirect: "error" }) }, initializationOptions: { signal, timeout: 10_000 } });
  try {
    const tools = await client.tools();
    if (!tools.initial_context || !tools.knowledge_base_read) throw new Error("Knowledge Base tools missing");
    console.log("Context MCP handshake passed. initial_context and knowledge_base_read are available.");
  } finally { await client.close().catch(() => undefined); }
  if (!process.argv.includes("--exercise")) {
    console.log("READ PREFLIGHT ONLY. Set APP_URL and optionally LIVE_TEST_QUESTION, then rerun with --exercise for a billed model-backed investigation.");
    return;
  }
  if (!process.env.APP_URL) throw new Error("APP_URL is required for live acceptance checks");
  const question = process.env.LIVE_TEST_QUESTION || selected.knowledgeBase.suggestedQuestions[0];
  if (!question) throw new Error("Provide a real acceptance question for the selected corpus");
  console.log("Running a live investigation; this consumes model-provider quota.");
  const result = await verifyLiveInvestigation(process.env.APP_URL, config.accessCode, { knowledgeBaseId: recordId, question });
  console.log(JSON.stringify({ status: "LIVE_ACCEPTANCE_PASSED", projectId: config.projectId, investigation: result }, null, 2));
}

check().catch(() => { console.error("Live verification failed. Check npm run doctor, APP_URL, the running server's live mode, organization Context Viewer access, the Knowledge Base build, and model access. No credentials or provider response bodies were logged."); process.exitCode = 1; });