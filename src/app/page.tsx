import { connection } from "next/server";
import { InvestigationWorkspace } from "@/components/investigation-workspace";
import { appMode } from "@/lib/config";
import { getKnowledgeCatalog } from "@/lib/catalog";
import { documentBudget } from "@/lib/curation";

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.slice(0, 2000) || "";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const mode = appMode();
  const result = await getKnowledgeCatalog(mode);
  const params = await searchParams;
  const shared = { knowledgeBaseId: single(params.kb), question: single(params.q), asOf: /^\d{4}-\d{2}-\d{2}$/.test(single(params.asOf)) ? single(params.asOf) : "" };
  return <InvestigationWorkspace mode={mode} knowledgeBases={result.catalog?.knowledgeBases || []} sample={mode === "demo" ? result.catalog : null} catalogError={result.error} budget={result.catalog ? documentBudget(result.catalog) : null} shared={shared} />;
}
