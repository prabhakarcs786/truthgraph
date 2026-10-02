import { liveConfig, modelKeyVariable } from "./config";

export function inspectConfiguration(environment: Record<string, string | undefined> = process.env) {
  const issues: string[] = [];
  let modelKey = "OPENAI_API_KEY";
  try { modelKey = modelKeyVariable(environment); } catch { issues.push("MODEL_PROVIDER must be openai or google."); }
  const liveVariables = ["SANITY_STUDIO_PROJECT_ID", "SANITY_CONTEXT_MCP_URL", "SANITY_ORGANIZATION_TOKEN", modelKey, "LIVE_ACCESS_CODE"];
  const missing = liveVariables.filter((name) => !environment[name]?.trim() || /^(YOUR_|CHOOSE_|REPLACE_)/i.test(environment[name]!.trim()));
  if (environment.APP_MODE !== "live") issues.push("Set APP_MODE=live after configuring the required services.");
  if (!missing.length && !issues.length) {
    try { liveConfig(environment); } catch { issues.push("SANITY_CONTEXT_MCP_URL must be a valid hosted Sanity Context endpoint."); }
  }
  if (environment.LIVE_ACCESS_CODE && environment.LIVE_ACCESS_CODE.length < 24) issues.push("Use a LIVE_ACCESS_CODE of at least 24 characters.");
  if (environment.APP_URL) {
    try { applicationOrigin(environment.APP_URL); } catch { issues.push("APP_URL must be an HTTPS origin or a localhost HTTP origin without a path, query, or credentials."); }
  }
  return { configured: missing.length === 0 && issues.length === 0, missing, issues, liveVerified: false };
}

export function applicationOrigin(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_URL must be your HTTPS application origin or a localhost HTTP origin, without credentials, path, query, or fragment.");
  }
  return url.origin;
}