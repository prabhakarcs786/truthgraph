import { describe, expect, it } from "vitest";
import { appMode, modelSettings } from "./config";
import { applicationOrigin, inspectConfiguration } from "./readiness";

describe("live readiness", () => {
  it("does not silently deploy production in demo mode", () => {
    expect(() => appMode({ NODE_ENV: "production" })).toThrow("APP_MODE explicitly");
    expect(appMode({ NODE_ENV: "production", APP_MODE: "demo" })).toBe("demo");
  });
  it("reports missing names without credential values", () => {
    const result = inspectConfiguration({ OPENAI_API_KEY: "not-a-real-private-value" });
    expect(result.configured).toBe(false);
    expect(result.missing).toContain("SANITY_ORGANIZATION_TOKEN");
    expect(JSON.stringify(result)).not.toContain("not-a-real-private-value");
  });
  it("does not mistake configuration for verified connectivity", () => {
    const result = inspectConfiguration({ APP_MODE: "live", SANITY_STUDIO_PROJECT_ID: "testproj", SANITY_CONTEXT_MCP_URL: "https://api.sanity.io/v1/context/organizations/example/mcp/release-desk", SANITY_ORGANIZATION_TOKEN: "test-only-token", OPENAI_API_KEY: "test-only-key", LIVE_ACCESS_CODE: "test-only-long-access-code-value" });
    expect(result.configured).toBe(true);
    expect(result.liveVerified).toBe(false);
  });
  it("accepts Gemini as the only configured model provider", () => {
    const gemini = { APP_MODE: "live", SANITY_STUDIO_PROJECT_ID: "testproj", SANITY_CONTEXT_MCP_URL: "https://api.sanity.io/v1/context/organizations/example/mcp/release-desk", SANITY_ORGANIZATION_TOKEN: "test-only-token", GOOGLE_GENERATIVE_AI_API_KEY: "test-only-key", LIVE_ACCESS_CODE: "test-only-long-access-code-value" };
    expect(inspectConfiguration(gemini).configured).toBe(true);
    expect(modelSettings(gemini)).toMatchObject({ provider: "google", model: "gemini-3.5-flash-lite" });
    expect(inspectConfiguration({ ...gemini, MODEL_PROVIDER: "openai" }).missing).toContain("OPENAI_API_KEY");
    expect(inspectConfiguration({ ...gemini, MODEL_PROVIDER: "other" }).issues).toContain("MODEL_PROVIDER must be openai or google.");
  });
  it("does not transmit judge codes to non-TLS remote targets", () => {
    expect(applicationOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(applicationOrigin("https://example.test")).toBe("https://example.test");
    expect(() => applicationOrigin("http://example.test")).toThrow("HTTPS");
    expect(() => applicationOrigin("https://user:password@example.test")).toThrow("HTTPS");
    expect(() => applicationOrigin("https://example.test?token=test")).toThrow("HTTPS");
  });
});