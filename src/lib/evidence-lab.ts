import { z } from "zod";
import { intentSchema, investigationSchema, knowledgeSourceSchema, type EvidenceItem, type EvidenceState, type Investigation, type KnowledgeCatalog } from "./knowledge";
import { reasonOverEvidence } from "./reasoning";

export const evidenceScenarioSchema = z.object({
  version: intentSchema.shape.version,
  asOf: intentSchema.shape.asOf,
  conditions: intentSchema.shape.conditions,
  excludedSourceIds: z.array(knowledgeSourceSchema.shape._id).max(150),
}).superRefine((scenario, context) => {
  const keys = scenario.conditions.map((condition) => condition.key.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["conditions"], message: "Choose one value per condition." });
});

export type EvidenceScenario = z.infer<typeof evidenceScenarioSchema>;
export type ScenarioState = EvidenceState | "excluded";
export type ScenarioRow = { original: EvidenceItem; state: ScenarioState; reasons: string[]; replacedBy: string[]; changed: boolean };

export function compareEvidenceScenario(result: Investigation, input: EvidenceScenario) {
  const scenario = evidenceScenarioSchema.parse(input);
  const sourceIds = new Set(result.evidence.map((item) => item.source._id));
  if (scenario.excludedSourceIds.some((id) => !sourceIds.has(id))) throw new Error("Only sources in the retrieved evidence can be excluded.");
  const excluded = new Set(scenario.excludedSourceIds);
  const included = result.evidence.filter((item) => !excluded.has(item.source._id));
  const catalog: KnowledgeCatalog = {
    knowledgeBases: [result.knowledgeBase],
    claims: included.map((item) => item.claim),
    sources: [...new Map(included.map((item) => [item.source._id, item.source])).values()],
  };
  const evaluated = reasonOverEvidence(
    { knowledgeBaseId: result.knowledgeBase._id, question: result.question },
    { ...result.intent, subjects: [], predicates: [], version: scenario.version, asOf: scenario.asOf, conditions: scenario.conditions },
    catalog.claims.map((claim) => claim._id), catalog, result.mode, result.asOf,
  );
  const evaluatedById = new Map(evaluated.evidence.map((item) => [item.claim._id, item]));
  const rows: ScenarioRow[] = result.evidence.map((original) => {
    const after = evaluatedById.get(original.claim._id);
    const state = after?.state ?? "excluded";
    const replacedBy = after?.replacedBy ?? [];
    return {
      original, state, replacedBy,
      reasons: after?.reasons ?? ["This source is excluded from the hypothetical scenario."],
      changed: original.state !== state || original.replacedBy.length !== replacedBy.length || original.replacedBy.some((id) => !replacedBy.includes(id)),
    };
  });
  return {
    scenario, rows,
    changedCount: rows.filter((row) => row.changed).length,
    applicableCount: rows.filter((row) => row.state === "applicable").length,
    excludedCount: rows.filter((row) => row.state === "excluded").length,
    conflicts: evaluated.conflicts,
    pending: evaluated.followUp,
  };
}

export function scenarioReport(result: Investigation, scenario: EvidenceScenario) {
  const original = investigationSchema.parse(result);
  const comparison = compareEvidenceScenario(original, scenario);
  return JSON.stringify({
    schema: "truthgraph.evidence-scenario.v1",
    kind: "hypothetical",
    scope: "Retrieved evidence snapshot only. No new retrieval or model call. Excluding a source does not resolve the original disagreement. Other evidence may exist.",
    original,
    comparison: {
      context: comparison.scenario,
      changes: comparison.rows.map((row) => ({ claimId: row.original.claim._id, sourceId: row.original.source._id, before: row.original.state, after: row.state, reasons: row.reasons, replacedBy: row.replacedBy, changed: row.changed })),
      conflicts: comparison.conflicts,
      pending: comparison.pending,
    },
  }, null, 2);
}