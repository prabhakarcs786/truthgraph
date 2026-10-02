import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SharedInvestigation } from "@/components/shared-investigation";
import { getSharedInvestigation } from "@/lib/investigation-sharing";

export const metadata = { title: "Saved Investigation | TruthGraph", robots: { index: false, follow: false } };

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const saved = await getSharedInvestigation(id);
  if (!saved) notFound();
  return <SharedInvestigation result={saved.result} recordedAt={saved.recordedAt} />;
}