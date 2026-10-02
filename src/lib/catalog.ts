import "server-only";
import { createClient } from "@sanity/client";
import { type AppMode } from "./config";
import { knowledgeCatalogQuery, knowledgeCatalogSchema, type KnowledgeCatalog } from "./knowledge";
import { sampleCatalog } from "./sample-data";

export async function getKnowledgeCatalog(mode: AppMode, signal?: AbortSignal): Promise<{ catalog: KnowledgeCatalog | null; error: string | null }> {
  if (mode === "demo") return { catalog: sampleCatalog, error: null };
  try {
    const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
    if (!projectId) throw new Error("Missing project configuration");
    const client = createClient({ projectId, dataset: process.env.SANITY_STUDIO_DATASET || "production", apiVersion: "2026-09-01", useCdn: false, token: process.env.SANITY_WRITE_TOKEN || process.env.SANITY_READ_TOKEN, perspective: "published", timeout: 8000, maxRetries: 0 });
    const data = await client.fetch(knowledgeCatalogQuery, {}, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    const catalog = knowledgeCatalogSchema.parse(data);
    if (!catalog.knowledgeBases.length) throw new Error("No configured knowledge bases");
    return { catalog, error: null };
  } catch {
    return { catalog: null, error: "The live knowledge catalog is unavailable or invalid. Check the project, read access, seed content, references, and record limits. No sample content was substituted." };
  }
}
