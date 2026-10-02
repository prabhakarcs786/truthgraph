import { describe, expect, it, vi } from "vitest";
import { accessMatches, createBudget, handleInvestigation } from "./http";
import { investigateSample } from "./sample-investigation";

const body = { knowledgeBaseId: "tg-kb-framework-notes", question: "What runtime does Next.js 16 require?" };
const request = (payload = JSON.stringify(body), headers = {}) => new Request("http://localhost/api/investigate", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: payload });

describe("question-first HTTP boundary", () => {
  it("accepts a question without a version-specific profile", async () => {
    const response = await handleInvestigation(request(), { mode: "demo", run: investigateSample });
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.mode).toBe("sample");
    expect(result.answer).toContain("20.9.0");
    expect(result.profile).toBeUndefined();
  });
  it.each([["{", 400], [JSON.stringify({ question: "hi" }), 400], ["x".repeat(9000), 413]])("rejects invalid requests before execution", async (payload, status) => {
    const run = vi.fn(investigateSample);
    expect((await handleInvestigation(request(String(payload)), { mode: "demo", run })).status).toBe(status);
    expect(run).not.toHaveBeenCalled();
  });
  it("keeps paid model calls behind the access code", async () => {
    const run = vi.fn(investigateSample);
    expect((await handleInvestigation(request(), { mode: "live", accessCode: "test-code", run })).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
  it("does not expose provider errors or silently substitute sample content", async () => {
    const response = await handleInvestigation(request(undefined, { "x-judge-code": "test-code" }), { mode: "live", accessCode: "test-code", run: () => { throw new Error("secret-provider-key"); } });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret-provider-key");
  });
  it("rejects cross-origin calls and exhausted budgets", async () => {
    expect((await handleInvestigation(request(undefined, { Origin: "https://elsewhere.example" }), { mode: "demo", run: investigateSample })).status).toBe(403);
    expect((await handleInvestigation(request(undefined, { "x-judge-code": "test" }), { mode: "live", accessCode: "test", permit: () => false, run: investigateSample })).status).toBe(429);
  });
  it("accepts the real browser host behind an internal Next.js hostname", async () => {
    expect((await handleInvestigation(request(undefined, { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" }), { mode: "demo", run: investigateSample })).status).toBe(200);
    expect((await handleInvestigation(request(undefined, { "Content-Type": "text/plain" }), { mode: "demo", run: investigateSample })).status).toBe(415);
  });
  it("fails closed for missing access configuration and resets its budget", async () => {
    expect((await handleInvestigation(request(), { mode: "live", run: investigateSample })).status).toBe(503);
    expect(accessMatches("", "")).toBe(false);
    let time = 0;
    const permit = createBudget(1, () => time);
    expect(permit()).toBe(true);
    expect(permit()).toBe(false);
    time = 60_000;
    expect(permit()).toBe(true);
  });
});