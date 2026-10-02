export type AppMode = "demo" | "live";

export function appMode(environment: Record<string, string | undefined> = process.env): AppMode {
  if (environment.NODE_ENV === "production" && !environment.APP_MODE) throw new Error("Set APP_MODE explicitly before serving a production deployment.");
  const mode = environment.APP_MODE ?? "demo";
  if (mode !== "demo" && mode !== "live") throw new Error("APP_MODE must be demo or live.");
  return mode;
}

export type ModelProvider = "openai" | "google";

const providerKeys = { openai: "OPENAI_API_KEY", google: "GOOGLE_GENERATIVE_AI_API_KEY" } as const;
const providerModels = { openai: ["OPENAI_MODEL", "gpt-4.1-mini"], google: ["GOOGLE_MODEL", "gemini-3.5-flash-lite"] } as const;

// Without MODEL_PROVIDER, Gemini is used only when it is the sole configured key.
export function modelProvider(environment: Record<string, string | undefined> = process.env): ModelProvider {
  const explicit = environment.MODEL_PROVIDER?.trim();
  const provider = explicit || (!environment.OPENAI_API_KEY?.trim() && environment.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ? "google" : "openai");
  if (provider !== "openai" && provider !== "google") throw new Error("MODEL_PROVIDER must be openai or google.");
  return provider;
}

export function modelKeyVariable(environment: Record<string, string | undefined> = process.env) {
  return providerKeys[modelProvider(environment)];
}

export function modelSettings(environment: Record<string, string | undefined> = process.env) {
  const provider = modelProvider(environment);
  const [modelVariable, fallback] = providerModels[provider];
  return { provider, apiKey: environment[providerKeys[provider]]?.trim() || undefined, model: environment[modelVariable]?.trim() || fallback };
}

export function liveConfig(environment: Record<string, string | undefined> = process.env) {
  const required = ["SANITY_CONTEXT_MCP_URL", "SANITY_ORGANIZATION_TOKEN", modelKeyVariable(environment), "SANITY_STUDIO_PROJECT_ID", "LIVE_ACCESS_CODE"] as const;
  const missing = required.filter((name) => !environment[name]?.trim());
  if (missing.length) throw new Error(`Missing live configuration: ${missing.join(", ")}.`);
  const url = new URL(environment.SANITY_CONTEXT_MCP_URL!);
  if (url.protocol !== "https:" || url.hostname !== "api.sanity.io" || !/^\/v1\/context\/organizations\/[^/]+\/mcp\/[^/]+$/.test(url.pathname) || url.username || url.password || url.hash) {
    throw new Error("Use the HTTPS Context MCP URL copied from the Sanity Dashboard.");
  }
  return {
    mcpUrl: url.toString(),
    organizationToken: environment.SANITY_ORGANIZATION_TOKEN!,
    model: { ...modelSettings(environment), apiKey: environment[modelKeyVariable(environment)]!.trim() },
    projectId: environment.SANITY_STUDIO_PROJECT_ID!,
    dataset: environment.SANITY_STUDIO_DATASET || "production",
    accessCode: environment.LIVE_ACCESS_CODE!,
  };
}