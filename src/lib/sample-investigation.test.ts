import { describe, expect, it } from "vitest";
import { investigateSample, selectSampleEvidence } from "./sample-investigation";
import { realSampleCatalog } from "./sample-data";

describe("question-first sample exploration", () => {
  it("different questions retrieve different claims, without a profile form", () => {
    const runtime = investigateSample({ knowledgeBaseId: "tg-kb-framework-notes", question: "What Node.js runtime does Next.js 16 require?" });
    const proxy = investigateSample({ knowledgeBaseId: "tg-kb-framework-notes", question: "Can proxy run on Edge in Next.js 16?" });
    expect(runtime.answer).toContain("20.9.0");
    expect(proxy.answer).toContain("keep using middleware");
    expect(runtime.evidence.map((item) => item.claim._id)).not.toEqual(proxy.evidence.map((item) => item.claim._id));
    expect(runtime.evidence).toHaveLength(2);
  });
  it("extracts version constraints from the question", () => {
    expect(investigateSample({ knowledgeBaseId: "tg-kb-framework-notes", question: "What is the minimum Node runtime for Next 15?" }).answer).toContain("18.18");
    expect(investigateSample({ knowledgeBaseId: "tg-kb-framework-notes", question: "What Node runtime is needed?" }).status).toBe("needs-context");
  });
  it("does not invent evidence for unrelated questions", () => {
    expect(investigateSample({ knowledgeBaseId: "tg-kb-framework-notes", question: "What is the warranty on a camera?" }).status).toBe("insufficient");
  });
  it("demonstrates effective-date and correction behavior with explicitly synthetic records", () => {
    const before = investigateSample({ knowledgeBaseId: "tg-kb-reasoning-lab", question: "What was the Atlas upload limit on 2026-06-30?" });
    const after = investigateSample({ knowledgeBaseId: "tg-kb-reasoning-lab", question: "What was the Atlas upload limit on 2026-08-01?" });
    expect(before.answer).toContain("10 MB");
    expect(after.answer).toContain("20 MB");
    expect(after.knowledgeBase.kind).toBe("synthetic");
    expect(after.conflicts[0].resolved).toBe(true);
  });
  it("exposes unresolved synthetic conflicts", () => {
    expect(investigateSample({ knowledgeBaseId: "tg-kb-reasoning-lab", question: "What is the Atlas return window?" }).status).toBe("conflict");
  });
  it("extracts a partial version without guessing its patch", () => {
    const request = { knowledgeBaseId: "tg-kb-reasoning-lab", question: "Is offline export available in Atlas 4.2?" };
    expect(selectSampleEvidence(request).intent.version?.value).toBe("4.2");
    expect(investigateSample(request).status).toBe("needs-context");
  });
  it("keeps fabricated test records out of the default Sanity seed", () => {
    const corpus = realSampleCatalog();
    expect(corpus.knowledgeBases.every((base) => base.kind === "real")).toBe(true);
    expect(corpus.sources.every((source) => !source.url.includes("example.org"))).toBe(true);
  });
});