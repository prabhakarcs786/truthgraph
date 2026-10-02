import { knowledgeCatalogSchema, type KnowledgeCatalog } from "./knowledge";
import { lifecycleClaims, lifecycleKnowledgeBase, lifecycleSources } from "./lifecycle-corpus";
import { chessClaims, chessKnowledgeBase, chessSources, cricketClaims, cricketKnowledgeBase, cricketSources, footballClaims, footballKnowledgeBase, footballSources } from "./sports-corpus";

const labBase = "tg-kb-reasoning-lab";

const labSource = { knowledgeBaseId: labBase, publisher: "TruthGraph synthetic test fixtures", authority: "unverified", reviewedAt: "2026-10-01" };
const labClaim = { knowledgeBaseId: labBase, subject: "Atlas", exclusive: true, version: null, effectiveFrom: "2026-01-01", effectiveUntil: null, conditions: [], relations: [] };

export const sampleCatalog: KnowledgeCatalog = knowledgeCatalogSchema.parse({
  knowledgeBases: [
    footballKnowledgeBase,
    cricketKnowledgeBase,
    chessKnowledgeBase,
    lifecycleKnowledgeBase,
    { _id: labBase, title: "Reasoning lab", description: "Synthetic records for demonstrating dates, corrections, and conflicts. Atlas is fictional. These are not real policies or competition evidence.", kind: "synthetic", mcpId: null, suggestedQuestions: ["What was the Atlas upload limit on 2026-06-30?", "What was the Atlas upload limit on 2026-08-01?", "What is the Atlas return window?", "Is offline export available in Atlas 4.2?"] },
  ],
  sources: [...footballSources, ...cricketSources, ...chessSources, ...lifecycleSources,
    { ...labSource, _id: "tg-source-lab-manual", title: "Synthetic Atlas manual", url: "https://example.org/atlas/manual", publishedAt: "2026-01-01" },
    { ...labSource, _id: "tg-source-lab-correction", title: "Synthetic Atlas correction", url: "https://example.org/atlas/correction", publishedAt: "2026-08-01" },
    { ...labSource, _id: "tg-source-lab-policy", title: "Synthetic Atlas policy", url: "https://example.org/atlas/policy", publishedAt: "2026-07-01" },
  ],
  claims: [...footballClaims, ...cricketClaims, ...chessClaims, ...lifecycleClaims,
    { ...labClaim, _id: "tg-claim-lab-upload-original", sourceId: "tg-source-lab-manual", predicate: "maximum upload size", value: "10 MB", statement: "The synthetic Atlas manual sets a maximum upload size of 10 MB.", aliases: ["upload", "upload size", "limit"] },
    { ...labClaim, _id: "tg-claim-lab-upload-correction", sourceId: "tg-source-lab-correction", predicate: "maximum upload size", value: "20 MB", statement: "The synthetic Atlas correction sets the upload limit to 20 MB from August 1, 2026.", aliases: ["upload", "upload size", "limit"], effectiveFrom: "2026-08-01", relations: [{ kind: "corrects", targetId: "tg-claim-lab-upload-original", reason: "This fictional correction explicitly replaces the original upload limit from its effective date." }] },
    { ...labClaim, _id: "tg-claim-lab-return-manual", sourceId: "tg-source-lab-manual", predicate: "return window", value: "30 days", statement: "The synthetic Atlas manual states that returns are accepted within 30 days.", aliases: ["return", "returns", "refund", "return window"] },
    { ...labClaim, _id: "tg-claim-lab-return-policy", sourceId: "tg-source-lab-policy", predicate: "return window", value: "45 days", statement: "The synthetic Atlas policy states that returns are accepted within 45 days.", aliases: ["return", "returns", "refund", "return window"] },
    { ...labClaim, _id: "tg-claim-lab-export", sourceId: "tg-source-lab-manual", predicate: "offline export support", value: "supported", statement: "The synthetic Atlas records support offline export from version 4.2.3 up to, but excluding, version 5.", aliases: ["offline", "export", "offline export"], version: { subject: "Atlas", range: ">=4.2.3 <5" } },
  ],
});

// The Node.js lifecycle desk stays a local sample only; the Sanity Knowledge Base holds the sports collections.
export function realSampleCatalog({ includeLocalSamples = false } = {}): KnowledgeCatalog {
  const knowledgeBases = sampleCatalog.knowledgeBases.filter((base) => base.kind === "real" && (includeLocalSamples || base._id !== lifecycleKnowledgeBase._id));
  const ids = new Set(knowledgeBases.map((base) => base._id));
  return knowledgeCatalogSchema.parse({ knowledgeBases, sources: sampleCatalog.sources.filter((source) => ids.has(source.knowledgeBaseId)), claims: sampleCatalog.claims.filter((claim) => ids.has(claim.knowledgeBaseId)) });
}