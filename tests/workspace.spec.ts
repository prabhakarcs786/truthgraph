import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { sampleCatalog } from "../src/lib/sample-data";
import { reasonOverEvidence } from "../src/lib/reasoning";

async function ask(page: Page, question: string) {
  if (!await page.getByLabel("Knowledge base", { exact: true }).inputValue()) await page.getByLabel("Knowledge base", { exact: true }).selectOption("tg-kb-framework-notes");
  await page.getByLabel("Your question", { exact: true }).fill(question);
  const response = page.waitForResponse((result) => result.url().endsWith("/api/investigate") && result.request().method() === "POST");
  await page.locator(".tg-composer").getByRole("button", { name: "Investigate", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Investigation complete." })).toBeVisible();
}

test("asks different questions and exports a source-backed investigation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Which answer applies?" })).toBeVisible();
  await expect(page.getByText("Sample / local retrieval", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Scenario", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Node.js runtime")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
  await ask(page, "What Node.js runtime does Next.js 16 require?");
  await expect(page.locator(".tg-answer")).toContainText("20.9.0");
  await expect(page.locator(".tg-evidence-item")).toHaveCount(2);
  await ask(page, "Can proxy run on Edge in Next.js 16?");
  await expect(page.locator(".tg-answer")).toContainText("keep using middleware");
  await expect(page.locator(".tg-answer")).not.toContainText("20.9.0");
  await page.screenshot({ path: testInfo.outputPath("investigation.png"), fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download investigation" }).click();
  expect((await download).suggestedFilename()).toBe("truthgraph-investigation.md");
  await page.getByLabel("Your question", { exact: true }).fill("A changed question");
  await expect(page.getByText("The question or context changed.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("shows temporal corrections and unresolved conflicts without silently choosing a winner", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Knowledge base", { exact: true }).selectOption("tg-kb-reasoning-lab");
  await expect(page.getByText("Synthetic reasoning fixtures.", { exact: false })).toBeVisible();
  await ask(page, "What was the Atlas upload limit on 2026-06-30?");
  await expect(page.locator(".tg-answer")).toContainText("10 MB");
  await page.getByLabel(/As of/).fill("2026-08-01");
  await ask(page, "What is the Atlas upload limit?");
  await expect(page.locator(".tg-answer")).toContainText("20 MB");
  await expect(page.getByText("Explicit relationship establishes precedence", { exact: true })).toBeVisible();
  await expect(page.locator(".tg-state-superseded")).toBeVisible();
  await ask(page, "What is the Atlas return window?");
  await expect(page.getByRole("heading", { name: "Sources disagree" })).toBeVisible();
  await expect(page.locator(".tg-claim-pair")).toContainText("30 days");
  await expect(page.locator(".tg-claim-pair")).toContainText("45 days");
  await expect(page.locator(".tg-resolution")).toContainText("does not settle");
  await page.screenshot({ path: testInfo.outputPath("conflict.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("asks for missing patch context and admits insufficient evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Knowledge base", { exact: true }).selectOption("tg-kb-reasoning-lab");
  await ask(page, "Is offline export available in Atlas 4.2?");
  await expect(page.getByRole("heading", { name: "Clarification needed" })).toBeVisible();
  await expect(page.locator(".tg-follow-up")).toContainText("Specify the exact Atlas version");
  await ask(page, "Is offline export available in Atlas 4.2.3?");
  await expect(page.getByRole("heading", { name: "Supported answer" })).toBeVisible();
  await ask(page, "What does a camera warranty cover?");
  await expect(page.getByRole("region", { name: "Insufficient evidence", exact: true })).toContainText("Insufficient evidence in the Knowledge Base.");
  await expect(page.locator(".tg-evidence-item")).toHaveCount(0);
});

test("inspects arbitrary structured records and switches knowledge bases", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Knowledge base", { exact: true }).selectOption("tg-kb-framework-notes");
  await page.getByRole("button", { name: "Evidence library", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search evidence" }).fill("middleware");
  await expect(page.locator(".tg-library-record")).toHaveCount(3);
  await page.locator(".tg-library-record summary").first().click();
  await expect(page.locator(".tg-library-record pre").first()).toBeVisible();
  await page.getByRole("button", { name: "Knowledge bases", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Node.js & Next.js lifecycle desk" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reasoning lab" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("supports keyboard access and accessible mobile/desktop views", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await expect.poll(() => page.locator(".tg-brand img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await ask(page, "What runtime does Next.js 16 require?");
  for (const view of ["Investigate", "Evidence library", "Knowledge bases"]) {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: view, exact: true }).click();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("uploads new knowledge privately and preserves it across reloads", async ({ page }, testInfo) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/(investigate|knowledge-bases)$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Import knowledge base", exact: true }).click();
  await page.getByLabel("Knowledge base title", { exact: true }).fill("Harbor workshop handbook");
  await page.getByLabel("Purpose and scope", { exact: true }).fill("Workshop membership, opening hours, and borrowing policies.");
  await page.getByLabel("Source owner or publisher", { exact: true }).fill("Harbor Workshop");
  await page.getByLabel("Documents", { exact: true }).setInputFiles({ name: "harbor-handbook.md", mimeType: "text/markdown", buffer: Buffer.from("Harbor Workshop opens at 07:30 on weekdays. Annual membership costs 18 euros. Members can borrow tools for seven days.") });
  await expect(page.getByText("harbor-handbook.md", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your knowledge base" })).toBeVisible();
  await expect(page.getByText("Destination: this browser", { exact: true })).toBeVisible();
  await page.locator(".tg-import-preview summary").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".tg-import-preview p")).toContainText("07:30");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("import-review.png"), fullPage: true });
  await expect(page.getByRole("button", { name: "Save locally", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "I reviewed the content and have permission to import it." }).check();
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByLabel("Knowledge base", { exact: true }).locator("option:checked")).toHaveText("Harbor workshop handbook");
  await page.getByLabel("Your question", { exact: true }).fill("When does Harbor Workshop open?");
  await page.locator(".tg-composer").getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(page.locator(".tg-answer")).toContainText("07:30");
  await expect(page.getByRole("link", { name: /Open harbor-handbook/ })).toHaveCount(0);
  await expect(page.locator("a[href^='urn:']")).toHaveCount(0);
  await expect(page.locator(".tg-source-fingerprint")).toContainText("urn:sha256:");
  await expect(page.locator(".tg-trace")).toContainText("No uploaded content was sent to a server or a model.");
  await page.reload();
  await expect(page.getByLabel("Knowledge base", { exact: true }).locator("option").filter({ hasText: "Harbor workshop handbook" })).toHaveCount(1);
  await page.getByLabel("Knowledge base", { exact: true }).selectOption({ label: "Harbor workshop handbook" });
  await page.getByLabel("Your question", { exact: true }).fill("What does annual membership cost?");
  await page.locator(".tg-composer").getByRole("button", { name: "Investigate", exact: true }).click();
  await expect(page.locator(".tg-answer")).toContainText("18 euros");
  await page.getByRole("button", { name: "Evidence library", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search evidence" }).fill("seven days");
  await expect(page.locator(".tg-library-record")).toHaveCount(1);
  await page.getByRole("button", { name: "Knowledge bases", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Harbor workshop handbook JSON", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("truthgraph-harbor-workshop-handbook.json");
  const remove = page.getByRole("button", { name: "Remove Harbor workshop handbook", exact: true });
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Remove local knowledge base?" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  await remove.click();
  await page.getByRole("button", { name: "Remove local import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Harbor workshop handbook", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Node.js & Next.js lifecycle desk", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Knowledge base", { exact: true }).locator("option:not([value=''])")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("rejects invalid uploads and duplicate local documents without losing data", async ({ page }) => {
  await page.goto("/");
  const importError = page.locator(".tg-import-panel").getByRole("alert");
  async function openImport() {
    await page.getByRole("button", { name: "Import knowledge base", exact: true }).click();
    await page.getByLabel("Knowledge base title", { exact: true }).fill("Membership policies");
    await page.getByLabel("Purpose and scope", { exact: true }).fill("Membership costs and borrowing rules.");
    await page.getByLabel("Source owner or publisher", { exact: true }).fill("Workshop owner");
  }
  async function review(name: string, buffer: Buffer) {
    await page.getByLabel("Documents", { exact: true }).setInputFiles({ name, mimeType: "application/octet-stream", buffer });
    await page.getByRole("button", { name: "Review import", exact: true }).click();
  }
  await openImport();
  await review("handbook.pdf", Buffer.from("Unsupported document format."));
  await expect(importError).toContainText("PDF and Office files are not supported");
  await review("broken.json", Buffer.from("{"));
  await expect(importError).toContainText("not valid JSON");
  await review("too-large.txt", Buffer.alloc(256 * 1024 + 1, "x"));
  await expect(importError).toContainText("256 KB");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  const documentBytes = Buffer.from("Annual membership costs 18 euros. Members may borrow tools for seven days.");
  await review("membership.txt", documentBytes);
  await page.getByRole("checkbox", { name: "I reviewed the content and have permission to import it." }).check();
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.getByLabel("Knowledge base", { exact: true }).locator("option:not([value=''])")).toHaveCount(6);
  await openImport();
  await review("membership-copy.txt", documentBytes);
  await page.getByRole("checkbox", { name: "I reviewed the content and have permission to import it." }).check();
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(importError).toContainText(/already|duplicate/i);
  await expect(page.getByRole("heading", { name: "Review your knowledge base" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel import", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Membership policies", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("starts with any supplied text and investigates its first question immediately", async ({ page }, testInfo) => {
  const sent: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/")) sent.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Add your documents", exact: true })).toBeVisible();
  await expect(page.getByLabel("Knowledge base", { exact: true })).toHaveValue("");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Or paste text", exact: true }).click();
  await expect(page.getByRole("button", { name: "Paste text", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Document text", { exact: true }).fill("Riverside repair club offers a monthly membership for 27 euros. Borrowed tools must be returned within nine days.");
  await page.getByRole("button", { name: "Review import", exact: true }).click();
  await page.getByLabel(/First question/).fill("How much is the monthly membership?");
  await page.getByRole("checkbox", { name: "I reviewed the content and have permission to import it." }).check();
  await page.getByRole("button", { name: "Save and investigate", exact: true }).click();
  await expect(page.locator(".tg-answer")).toContainText("27 euros");
  await expect(page.getByText("Private / local preview", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI on this upload", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("uploaded-answer.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Inspect evidence from pasted-document.txt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence library", exact: true })).toBeVisible();
  await expect(page.locator(".tg-library-record")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear source filter", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(sent).toEqual([]);
});

test("Evidence Lab compares versions locally and exports an explicitly hypothetical record", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") requests.push(request.url()); });
  await page.goto("/");
  await ask(page, "What Node.js runtime does Next.js 16 require?");
  const originalAnswer = await page.locator(".tg-answer").innerText();
  const requestCount = requests.length;
  const lab = page.locator(".tg-evidence-lab");
  await lab.locator("summary").first().focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Reset scenario", exact: true })).toBeFocused();
  await page.getByLabel("Scenario version", { exact: true }).fill("15");
  await expect(lab.locator(".tg-lab-summary")).toContainText("2 claim statuses changed");
  await expect(lab.locator('[data-claim-id="tg-claim-runtime-15"] [data-scenario-state="applicable"]')).toBeVisible();
  await expect(lab.locator('[data-claim-id="tg-claim-runtime-16"] [data-scenario-state="out-of-scope"]')).toBeVisible();
  expect(await page.locator(".tg-answer").innerText()).toBe(originalAnswer);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download comparison", exact: true }).click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("truthgraph-evidence-comparison.json");
  const report = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  expect(report.kind).toBe("hypothetical");
  expect(report.comparison.context.version.value).toBe("15");
  expect(report.original.answer).toContain("20.9.0");
  expect(report.comparison.changes).toEqual(expect.arrayContaining([expect.objectContaining({ claimId: "tg-claim-runtime-15", after: "applicable" })]));
  await page.getByLabel("Scenario version", { exact: true }).fill("latest");
  await expect(lab.getByRole("alert")).toHaveText("Invalid semantic version or range.");
  await expect(page.getByRole("button", { name: "Download comparison", exact: true })).toBeDisabled();
  await page.getByLabel("Scenario version", { exact: true }).fill("15");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await lab.screenshot({ path: testInfo.outputPath("evidence-lab-version.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toHaveLength(requestCount);
  await page.getByLabel("Your question", { exact: true }).fill("A different question");
  await expect(page.getByLabel("Scenario version", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download comparison", exact: true })).toBeDisabled();
});

test("Evidence Lab tests source dependence without silently resolving the original conflict", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Knowledge base", { exact: true }).selectOption("tg-kb-reasoning-lab");
  await ask(page, "What is the Atlas return window?");
  await expect(page.getByRole("heading", { name: "Sources disagree" })).toBeVisible();
  const lab = page.locator(".tg-evidence-lab");
  await lab.locator("summary").first().click();
  const sources = lab.getByRole("checkbox", { name: /^Include / });
  for (const checkbox of await sources.all()) await checkbox.uncheck();
  await expect(lab.getByText("No included claims in this scenario.", { exact: true })).toBeVisible();
  await expect(lab.locator(".tg-lab-warning")).toContainText("Original disagreements remain on record");
  await expect(page.getByRole("heading", { name: "Sources disagree" })).toBeVisible();
  await page.getByRole("button", { name: "Reset scenario", exact: true }).click();
  for (const checkbox of await sources.all()) await expect(checkbox).toBeChecked();
  await expect(lab.locator(".tg-lab-summary")).toContainText("1 unresolved disagreements");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await lab.screenshot({ path: testInfo.outputPath("evidence-lab-sources-320.png") });
  await ask(page, "What was the Atlas upload limit on 2026-06-30?");
  await expect(page.locator(".tg-answer")).toContainText("10 MB");
  await expect(lab).not.toHaveAttribute("open");
  await lab.locator("summary").first().click();
  await page.getByLabel("Scenario date", { exact: true }).fill("2026-08-01");
  await expect(lab.locator('[data-claim-id="tg-claim-lab-upload-original"] [data-scenario-state="superseded"]')).toBeVisible();
  await expect(lab.locator('[data-claim-id="tg-claim-lab-upload-correction"] [data-scenario-state="applicable"]')).toBeVisible();
  await expect(page.locator(".tg-answer")).toContainText("10 MB");
  await ask(page, "What Node.js runtime does Next.js 16 require?");
  await expect(lab).toHaveCount(0);
});

test("Evidence Lab accepts corpus-defined conditions without asserting a new live answer", async ({ page }) => {
  const question = "What Node.js runtime does Next.js 16 require?";
  const catalog = { ...sampleCatalog, claims: sampleCatalog.claims.map((claim) => claim._id === "tg-claim-runtime-16" ? { ...claim, conditions: [{ key: "region", value: "EU" }] } : claim) };
  const investigation = reasonOverEvidence(
    { knowledgeBaseId: "tg-kb-framework-notes", question },
    { summary: "Find the runtime requirement.", subjects: ["Next.js"], predicates: ["minimum Node.js runtime"], version: { subject: "Next.js", value: "16" }, asOf: null, conditions: [] },
    ["tg-claim-runtime-15", "tg-claim-runtime-16"], catalog, "sample", "2026-10-01",
  );
  await page.route("**/api/investigate", (route) => route.fulfill({ json: investigation }));
  await page.goto("/");
  await ask(page, question);
  await expect(page.getByRole("heading", { name: "Clarification needed", exact: true })).toBeVisible();
  const lab = page.locator(".tg-evidence-lab");
  await lab.locator("summary").first().click();
  await page.getByLabel("Scenario region", { exact: true }).fill("EU");
  await expect(lab.locator('[data-claim-id="tg-claim-runtime-16"] [data-scenario-state="applicable"]')).toBeVisible();
  await page.getByLabel("Scenario region", { exact: true }).fill("US");
  await expect(lab.locator('[data-claim-id="tg-claim-runtime-16"] [data-scenario-state="out-of-scope"]')).toBeVisible();
  await expect(lab).toContainText("Requires region = EU; supplied US.");
  await expect(page.getByRole("heading", { name: "Clarification needed", exact: true })).toBeVisible();
  await expect(lab.getByText("Original evidence gaps (1)")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});
test("guided tour contrasts keyword search with structured evidence and shares a link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Start the guided tour", exact: true }).click();
  const tour = page.getByRole("region", { name: /questions where keyword search goes wrong/ });
  await tour.getByRole("button", { name: /Rule replaced/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Investigation complete." })).toBeVisible();
  await expect(page.locator(".tg-answer")).toContainText("eight seconds");
  const comparison = page.getByRole("region", { name: "Keyword search vs TruthGraph" });
  await expect(comparison).toContainText("Not in effect on this date");
  await expect(comparison).toContainText("six seconds");
  await tour.getByRole("button", { name: /Match date matters/ }).click();
  await expect(page.locator(".tg-answer")).toContainText("six seconds");
  await tour.getByRole("button", { name: /Depends on the match/ }).click();
  await expect(page.getByRole("heading", { name: "Clarification needed" })).toBeVisible();
  await expect(page.locator(".tg-follow-up")).toContainText("international friendly");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Copy share link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Share link copied." })).toBeVisible();
  await page.goto(`/?kb=tg-kb-football-laws&q=${encodeURIComponent("How many substitutes can a team use?")}`);
  await expect(page.getByLabel("Your question", { exact: true })).toHaveValue("How many substitutes can a team use?");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
