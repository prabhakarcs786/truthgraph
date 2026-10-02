import { createClient, type SanityDocument } from "@sanity/client";
import { mkdir, writeFile } from "node:fs/promises";
import { realSampleCatalog } from "../src/lib/sample-data";
import { documentBudget } from "../src/lib/curation";

async function seed() {
  const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
  const token = process.env.SANITY_WRITE_TOKEN;
  if (!projectId || !token) throw new Error("Set SANITY_STUDIO_PROJECT_ID and a project-scoped SANITY_WRITE_TOKEN before seeding.");
  const client = createClient({ projectId, dataset: process.env.SANITY_STUDIO_DATASET || "production", apiVersion: "2026-09-01", token, useCdn: false });
  const corpus = realSampleCatalog();
  const ids = [...corpus.knowledgeBases, ...corpus.sources, ...corpus.claims].map((record) => record._id);
  const current = await client.fetch<{ documents: number; seeded: SanityDocument[] }>('{"documents":count(*[!(_id in path("drafts.**")) && !(_id in path("versions.**")) && !(_id in path("_.**"))]),"seeded":*[_id in $ids]}', { ids });
  const existing = new Map(current.seeded.map((document) => [document._id, document]));
  const projected = current.documents + ids.filter((id) => !existing.has(id)).length;
  const budget = documentBudget({ ...corpus, datasetDocumentCount: projected });
  if (budget.documents > budget.limit) throw new Error(`The seed corpus has ${budget.documents} documents; Knowledge Bases index up to ${budget.limit}.`);
  const updateExisting = process.argv.includes("--update-existing");
  if (process.argv.includes("--dry-run")) {
    console.log(`Seed preview: ${ids.length - existing.size} new records; ${updateExisting ? existing.size : 0} existing records refreshed. Projected dataset: ${budget.documents}/${budget.limit} documents. Curation relationships and MCP mappings are preserved.`);
    return;
  }
  if (updateExisting && current.seeded.length) {
    await mkdir("tmp", { recursive: true });
    const backup = `tmp/seed-backup-${Date.now()}.json`;
    await writeFile(backup, JSON.stringify(current.seeded, null, 2) + "\n", { mode: 0o600 });
    console.log(`Previous seeded records backed up to ${backup}.`);
  }
  const transaction = client.transaction();
  for (const [sortOrder, { _id, title, description, kind, suggestedQuestions, showcase }] of corpus.knowledgeBases.entries()) {
    const fields = { title, description, kind, suggestedQuestions, sortOrder, contentChangedAt: new Date().toISOString(), showcase: showcase.map(({ asOf, ...scenario }, index) => ({ ...scenario, ...(asOf ? { asOf } : {}), _key: `scenario-${index}`, _type: "showcaseScenario" })) };
    const prior = existing.get(_id);
    if (prior && updateExisting) transaction.patch(_id, (patch) => patch.ifRevisionId(prior._rev).set(fields));
    else transaction.createIfNotExists({ _id, _type: "tgKnowledgeBase", ...fields });
  }
  for (const { _id, knowledgeBaseId, ...source } of corpus.sources) {
    const fields = { ...source, knowledgeBase: { _type: "reference", _ref: knowledgeBaseId } };
    const prior = existing.get(_id);
    if (prior && updateExisting) transaction.patch(_id, (patch) => patch.ifRevisionId(prior._rev).set(fields));
    else transaction.createIfNotExists({ _id, _type: "tgSource", ...fields });
  }
  for (const { _id, sourceId, knowledgeBaseId, conditions, relations, ...claim } of corpus.claims) {
    const prior = existing.get(_id);
    const fields = {
      ...claim, knowledgeBase: { _type: "reference", _ref: knowledgeBaseId }, source: { _type: "reference", _ref: sourceId },
      conditions: conditions.map((condition, index) => ({ ...condition, _key: `condition-${index}`, _type: "applicabilityCondition" })),
      relations: prior ? prior.relations ?? [] : relations.map(({ targetId, ...relation }, index) => ({ ...relation, _key: `relation-${index}`, _type: "claimRelation", target: { _type: "reference", _ref: targetId } })),
    };
    if (prior && updateExisting) transaction.patch(_id, (patch) => patch.ifRevisionId(prior._rev).set(fields));
    else transaction.createIfNotExists({ _id, _type: "tgClaim", ...fields });
  }
  await transaction.commit({ visibility: "sync" });
  console.log(`Seeded ${corpus.knowledgeBases.length} knowledge base, ${corpus.sources.length} real sources, and ${corpus.claims.length} claims (${budget.documents}/${budget.limit} project documents). Existing mappings and curation relationships were preserved. Rebuild the Knowledge Base in the Context Dashboard.`);
}

seed().catch((error) => { console.error(`Seed failed: ${error instanceof Error ? error.message.slice(0, 300) : "unknown error"}. Check project access, source validity, document capacity, or concurrent changes.`); process.exitCode = 1; });
