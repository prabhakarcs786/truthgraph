import { type Investigation } from "./knowledge";

export function investigationMarkdown(result: Investigation): string {
  return [
    "# TruthGraph investigation", `Question: ${result.question}`, `Knowledge base: ${result.knowledgeBase.title}\nMode: ${result.mode}\nCorpus: ${result.knowledgeBase.kind}\nAs of: ${result.asOf}`,
    `## Answer\n${result.answer}`, `Evidence strength: ${result.confidence}\n${result.confidenceReason}`, `## Evidence summary\n${result.reasoningSummary}`,
    ...result.evidence.map((item) => `### ${item.claim._id}: ${item.state}\n${item.claim.statement}\n\n${item.reasons.join("\n")}\n\nSource: ${item.source.title}${result.knowledgeBase.kind === "real" ? ` (${item.source.url})` : " (synthetic fixture; not an external source)"}`),
    "## Conflicts", ...result.conflicts.map((conflict) => `${conflict.claimIds.join(" vs ")}: ${conflict.resolved ? "explicitly resolved" : "unresolved"}\n${conflict.resolution}`),
    ...(result.followUp.length ? ["## Missing context", ...result.followUp] : []),
    "## Application trace", ...result.trace.map((step) => `- ${step.stage}: ${step.detail}`),
    "Trace entries describe tool activity and deterministic decisions, not private chain-of-thought. Evidence strength is not a probability of truth.",
  ].join("\n\n");
}