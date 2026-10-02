import { z } from "zod";
import { mergeCatalogs, preparedImportSchema, type PreparedImport } from "./knowledge-import";
import { type KnowledgeCatalog } from "./knowledge";

export const importStorageKey = "truthgraph-imports-v1";
const snapshotSchema = z.object({ version: z.literal(1), imports: z.array(preparedImportSchema).max(18) });

export function loadImports(raw: string | null, initial: KnowledgeCatalog): { imports: PreparedImport[]; catalog: KnowledgeCatalog } {
  if (!raw) return { imports: [], catalog: initial };
  if (raw.length > 3_000_000) throw new Error("The saved import collection is too large.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("The saved imports could not be read. Export any recoverable data before clearing browser storage."); }
  const state = snapshotSchema.parse(parsed);
  const catalog = state.imports.reduce((current, imported) => mergeCatalogs(current, imported.catalog), initial);
  return { imports: state.imports, catalog };
}

export function serializeImports(imports: PreparedImport[]): string {
  const value = JSON.stringify(snapshotSchema.parse({ version: 1, imports }));
  if (value.length > 3_000_000) throw new Error("This browser's local import collection has reached its size limit. Export and remove an old import first.");
  return value;
}

export function appendImport(raw: string | null, prepared: PreparedImport, initial: KnowledgeCatalog) {
  const previous = loadImports(raw, initial);
  const candidate = preparedImportSchema.parse(prepared);
  const fingerprintSet = new Set(candidate.catalog.sources.map((source) => source.url));
  if (candidate.uploads.length && previous.imports.some((saved) => saved.uploads.length && saved.catalog.sources.length === fingerprintSet.size && saved.catalog.sources.every((source) => fingerprintSet.has(source.url)))) throw new Error("These documents are already imported in this browser.");
  const imports = [...previous.imports, candidate];
  const serialized = serializeImports(imports);
  return { ...loadImports(serialized, initial), serialized };
}

export function removeImport(raw: string | null, id: string, initial: KnowledgeCatalog) {
  const previous = loadImports(raw, initial);
  const imports = previous.imports.filter((imported) => imported.catalog.knowledgeBases[0]._id !== id);
  const serialized = serializeImports(imports);
  return { ...loadImports(serialized, initial), serialized };
}