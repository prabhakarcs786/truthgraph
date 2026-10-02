import { z } from "zod";
import { investigationRequestSchema, knowledgeCatalogSchema, type Claim, type KnowledgeCatalog } from "./knowledge";

export const importByteLimit = 256 * 1024;
export function importFileByteLimit(files: { name: string }[]): number {
  return files.length === 1 && /\.json$/i.test(files[0].name) ? 1024 * 1024 : importByteLimit;
}
export const importFileSchema = z.object({ name: z.string().min(1).max(180).refine((name) => !/[\\/]/.test(name) && !Array.from(name).some((character) => character.charCodeAt(0) < 32)), text: z.string().min(1).max(1024 * 1024) });
export const importMetadataSchema = z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(600), publisher: z.string().trim().min(2).max(120), kind: z.enum(["real", "synthetic"]) });
export const preparedImportSchema = z.object({
  catalog: knowledgeCatalogSchema,
  uploads: z.array(z.object({ sourceId: z.string(), name: z.string().max(180), text: z.string().max(importByteLimit) })).max(8),
}).superRefine((prepared, context) => {
  if (prepared.catalog.knowledgeBases.length !== 1 || !prepared.catalog.sources.length || !prepared.catalog.claims.length) context.addIssue({ code: "custom", message: "Import exactly one knowledge base with at least one source and claim." });
  if (prepared.catalog.claims.length > 100 || prepared.catalog.sources.length > 20) context.addIssue({ code: "custom", message: "An import can contain at most 100 claims and 20 sources." });
  if (new Set(prepared.uploads.map((upload) => upload.sourceId)).size !== prepared.uploads.length) context.addIssue({ code: "custom", message: "Uploaded sources must be unique." });
  const totalBytes = prepared.uploads.reduce((total, upload) => total + new TextEncoder().encode(upload.text).byteLength, 0);
  if (totalBytes > importByteLimit) context.addIssue({ code: "custom", message: "The combined upload exceeds 256 KB." });
  for (const upload of prepared.uploads) {
    const source = prepared.catalog.sources.find((candidate) => candidate._id === upload.sourceId);
    if (!source || source.fileName !== upload.name || !source.url.startsWith("urn:sha256:")) context.addIssue({ code: "custom", message: "Uploaded source provenance is inconsistent." });
    for (const claim of prepared.catalog.claims.filter((candidate) => candidate.sourceId === upload.sourceId)) {
      if (!upload.text.includes(claim.statement)) context.addIssue({ code: "custom", message: "Imported excerpts must appear verbatim in their uploaded source." });
    }
  }
  for (const source of prepared.catalog.sources) {
    if (source.url.startsWith("urn:") && !prepared.uploads.some((upload) => upload.sourceId === source._id)) context.addIssue({ code: "custom", message: "A file source requires its original uploaded text." });
  }
});

export type ImportMetadata = z.infer<typeof importMetadataSchema>;
export type ImportFile = z.infer<typeof importFileSchema>;
export type PreparedImport = z.infer<typeof preparedImportSchema>;

export const uploadInvestigationRequestSchema = z.object({
  prepared: preparedImportSchema,
  request: investigationRequestSchema,
  consent: z.literal(true),
}).refine((input) => input.prepared.catalog.knowledgeBases[0]?._id === input.request.knowledgeBaseId, "The question must refer to the uploaded knowledge base.");

export async function contentIdentifier(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `urn:sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function excerpts(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 1600) {
    const boundary = Math.max(remaining.lastIndexOf("\n", 1600), remaining.lastIndexOf(" ", 1600));
    const end = boundary > 100 ? boundary : 1600;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining.length >= 10) chunks.push(remaining);
  else if (remaining && chunks.length) {
    const start = text.lastIndexOf(chunks[chunks.length - 1]);
    chunks[chunks.length - 1] = text.slice(start).trim();
  }
  if (!chunks.length) throw new Error("A text document must contain at least 10 characters of readable content.");
  return chunks;
}

const commonWords = new Set("the and for that this with from have are was were will can not but you your our into then than they their these those shall must only about within under over its all any has been when which what how who where while also should would could document policy excerpt uploaded".split(" "));
function searchTerms(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,79}/gu) || [])].filter((word) => !commonWords.has(word)).slice(0, 20);
}

function rekeyCatalog(input: KnowledgeCatalog, id: string): KnowledgeCatalog {
  const ids = new Map([...input.knowledgeBases, ...input.sources, ...input.claims].map((record, index) => [record._id, `tg-upload-${id}-${index}`]));
  return knowledgeCatalogSchema.parse({
    knowledgeBases: input.knowledgeBases.map((base) => ({ ...base, _id: ids.get(base._id), mcpId: null })),
    sources: input.sources.map((source) => ({ ...source, _id: ids.get(source._id), knowledgeBaseId: ids.get(source.knowledgeBaseId) })),
    claims: input.claims.map((claim) => ({ ...claim, _id: ids.get(claim._id), knowledgeBaseId: ids.get(claim.knowledgeBaseId), sourceId: ids.get(claim.sourceId), relations: claim.relations.map((relation) => ({ ...relation, targetId: ids.get(relation.targetId) })) })),
  });
}

export async function prepareImport(metadataInput: ImportMetadata, filesInput: ImportFile[], id = crypto.randomUUID(), today = new Date().toISOString().slice(0, 10)): Promise<PreparedImport> {
  const metadata = importMetadataSchema.parse(metadataInput);
  const files = z.array(importFileSchema).min(1).max(8).parse(filesInput);
  if (!/^[a-zA-Z0-9-]{1,50}$/.test(id)) throw new Error("Invalid import identifier.");
  const byteLimit = importFileByteLimit(files);
  if (files.reduce((total, file) => total + new TextEncoder().encode(file.text).byteLength, 0) > byteLimit) throw new Error(`The combined upload exceeds ${byteLimit / 1024} KB.`);
  if (files.some((file) => !/\.(txt|md|markdown|json)$/i.test(file.name) || file.text.includes("\u0000"))) throw new Error("Only UTF-8 text, Markdown, and structured JSON files are supported.");
  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name));
  if (jsonFiles.length) {
    if (files.length !== 1) throw new Error("Import one structured JSON bundle at a time, separately from text documents.");
    let parsed: unknown;
    try { parsed = JSON.parse(jsonFiles[0].text); } catch { throw new Error("The JSON file is not valid JSON."); }
    const bundled = preparedImportSchema.safeParse(parsed);
    const catalog = bundled.success ? bundled.data.catalog : knowledgeCatalogSchema.parse(parsed);
    if (catalog.knowledgeBases.length !== 1) throw new Error("Choose a JSON bundle containing exactly one knowledge base.");
    const rekeyed = rekeyCatalog(catalog, id);
    rekeyed.knowledgeBases[0] = { ...rekeyed.knowledgeBases[0], title: metadata.title, description: metadata.description, kind: catalog.knowledgeBases[0].kind === "synthetic" ? "synthetic" : metadata.kind };
    const uploads = bundled.success ? bundled.data.uploads.map((upload) => ({ ...upload, sourceId: rekeyed.sources[catalog.sources.findIndex((source) => source._id === upload.sourceId)]._id })) : [];
    return validatePreparedImport({ catalog: rekeyed, uploads });
  }
  const baseId = `tg-upload-${id}-base`;
  const sources: KnowledgeCatalog["sources"] = [];
  const claims: Claim[] = [];
  const uploads: PreparedImport["uploads"] = [];
  for (const [fileIndex, file] of files.entries()) {
    const sourceId = `tg-upload-${id}-source-${fileIndex}`;
    sources.push({ _id: sourceId, knowledgeBaseId: baseId, title: file.name, publisher: metadata.publisher, url: await contentIdentifier(file.text), fileName: file.name, authority: "unverified", publishedAt: null, reviewedAt: today });
    uploads.push({ sourceId, name: file.name, text: file.text });
    for (const [index, statement] of excerpts(file.text).entries()) claims.push({ _id: `tg-upload-${id}-claim-${fileIndex}-${index}`, knowledgeBaseId: baseId, sourceId, subject: metadata.title, predicate: `Document excerpt ${fileIndex + 1}.${index + 1}`, value: `Excerpt ${index + 1}`, statement, aliases: searchTerms(statement), exclusive: false, version: null, effectiveFrom: null, effectiveUntil: null, conditions: [], relations: [] });
  }
  return preparedImportSchema.parse({ catalog: { knowledgeBases: [{ _id: baseId, title: metadata.title, description: metadata.description, kind: metadata.kind, mcpId: null, suggestedQuestions: [] }], sources, claims }, uploads });
}

export async function validatePreparedImport(input: unknown): Promise<PreparedImport> {
  const prepared = preparedImportSchema.parse(input);
  for (const upload of prepared.uploads) {
    if (prepared.catalog.sources.find((source) => source._id === upload.sourceId)?.url !== await contentIdentifier(upload.text)) throw new Error("An uploaded source fingerprint does not match its text.");
  }
  return prepared;
}

export function mergeCatalogs(existing: KnowledgeCatalog, incoming: KnowledgeCatalog): KnowledgeCatalog {
  return knowledgeCatalogSchema.parse({ knowledgeBases: [...existing.knowledgeBases, ...incoming.knowledgeBases], sources: [...existing.sources, ...incoming.sources], claims: [...existing.claims, ...incoming.claims], ...(existing.datasetDocumentCount === undefined ? {} : { datasetDocumentCount: existing.datasetDocumentCount + incoming.knowledgeBases.length + incoming.sources.length + incoming.claims.length }) });
}

export function exportImportMarkdown(preparedInput: PreparedImport): string {
  const prepared = preparedImportSchema.parse(preparedInput);
  const base = prepared.catalog.knowledgeBases[0];
  return [`# ${base.title}`, `Corpus: ${base.kind}\n${base.description}`, "Retain exact claim IDs, statements verbatim, source identifiers, effective metadata, and relationships. Missing metadata must not be invented.",
    ...prepared.catalog.claims.map((claim) => { const source = prepared.catalog.sources.find((item) => item._id === claim.sourceId)!; return `## ${claim._id}\n\n${claim.statement}\n\nSource: ${source.url}\n${source.fileName ? `Uploaded file: ${source.fileName}\n` : ""}\n\`\`\`json\n${JSON.stringify({ claim, source }, null, 2)}\n\`\`\``; }),
  ].join("\n\n");
}