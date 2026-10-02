import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { realSampleCatalog } from "../src/lib/sample-data";
import { knowledgeCatalogSchema } from "../src/lib/knowledge";

async function exportKnowledgeBase() {
  const input = process.argv.find((argument) => argument.startsWith("--catalog="))?.slice("--catalog=".length);
  const corpus = input ? knowledgeCatalogSchema.parse(JSON.parse(await readFile(input, "utf8"))) : realSampleCatalog();
  if (corpus.knowledgeBases.some((base) => base.kind !== "real")) throw new Error("Synthetic fixtures must not be exported as real Knowledge Base content.");
  const content = [
    "# TruthGraph source corpus",
    "Purpose: answer questions using applicable, source-grounded claims. This export contains original curated summaries, not copied documentation pages.",
    "Indexing instruction: retain each claim's exact _id, statement verbatim, original source URL, subject, predicate, value, version scope, effective dates, conditions, and relations. Include related and contradictory records. Do not merge different version scopes. Do not remove older claims needed for historical questions. Exact statements and source URLs are validated during retrieval.",
    ...corpus.knowledgeBases.map((base) => `## Knowledge base: ${base._id}\n${base.title}\n\n${base.description}`),
    "## Sources",
    ...corpus.sources.map((source) => `### ${source._id}: ${source.title}\n\n\`\`\`json\n${JSON.stringify(source, null, 2)}\n\`\`\`\n\nOriginal source: ${source.url}`),
    "## Claims",
    ...corpus.claims.map((claim) => {
      const source = corpus.sources.find((item) => item._id === claim.sourceId)!;
      return `### ${claim._id}: ${claim.subject} / ${claim.predicate}\n\n${claim.statement}\n\nOriginal source: ${source.url}\n\n\`\`\`json\n${JSON.stringify(claim, null, 2)}\n\`\`\``;
    }),
    "## Limits",
    "Publication dates, review dates, and effective dates are different. Null means no date is supplied, not a fabricated historical fact. Authority labels do not automatically resolve contradictions. Claims without sufficient evidence must not be invented. Review the source corpus and rebuild after edits.",
  ].join("\n\n");
  await mkdir("knowledge-base", { recursive: true });
  await writeFile("knowledge-base/truthgraph.md", content + "\n");
  if (!input) {
    await mkdir("public/sample-documents", { recursive: true });
    const files: Record<string, string> = { "tg-kb-football-laws": "football-rules.json", "tg-kb-cricket-laws": "cricket-rules.json", "tg-kb-chess-laws": "chess-rules.json", "tg-kb-framework-notes": "lifecycle.json" };
    for (const base of corpus.knowledgeBases) {
      if (!files[base._id]) continue;
      const subset = { knowledgeBases: [base], sources: corpus.sources.filter((source) => source.knowledgeBaseId === base._id), claims: corpus.claims.filter((claim) => claim.knowledgeBaseId === base._id) };
      await writeFile(`public/sample-documents/${files[base._id]}`, JSON.stringify(subset, null, 2) + "\n");
    }
    for (const name of ["python-lifecycle.json", "pep-0373-excerpt.md"]) await copyFile(`knowledge-base/samples/${name}`, `public/sample-documents/${name}`);
  }
  console.log(`Exported knowledge-base/truthgraph.md: ${corpus.knowledgeBases.length} knowledge bases, ${corpus.sources.length} sources, ${corpus.claims.length} claims. Only real source material was included.`);
}

exportKnowledgeBase().catch(() => { console.error("Knowledge Base export failed."); process.exitCode = 1; });