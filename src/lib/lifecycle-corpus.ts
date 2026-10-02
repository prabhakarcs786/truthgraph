import { type Claim, type KnowledgeBase, type KnowledgeSource } from "./knowledge";

// Original summaries of official pages, reviewed 2026-10-01. Effective-until dates are exclusive.
export const lifecycleBaseId = "tg-kb-framework-notes";
const base = lifecycleBaseId;

export const lifecycleKnowledgeBase: KnowledgeBase = {
  _id: base,
  title: "Node.js & Next.js lifecycle desk",
  description: "Original summaries of official Node.js and Next.js release schedules, support policies, and upgrade guides. Claims carry version ranges, effective dates, runtime conditions, and recorded corrections, so the agent can tell which answer applies on a given date.",
  kind: "real",
  mcpId: null,
  suggestedQuestions: [
    "What Node.js runtime does Next.js 16 require?",
    "Should I use proxy or middleware in Next.js 16 on the edge runtime?",
    "What is the default images minimumCacheTTL in Next.js 16?",
    "Is Node.js 22 still supported?",
    "What is the warranty on a camera?",
  ],
  showcase: [
    { title: "Corrected date", question: "What is the end-of-life date for Node.js 16?", asOf: null, lesson: "The original plan said April 2024. A 2022 announcement moved it to September 11, 2023. Keyword search can surface the outdated plan; TruthGraph follows the recorded correction." },
    { title: "Today's status", question: "Does Node.js 20 still get security updates?", asOf: null, lesson: "Three dated support phases match the words. Only the phase effective today applies: Node.js 20 reached End-of-Life on April 30, 2026." },
    { title: "Future date", question: "Will Next.js 15 still receive security fixes on 2026-11-01?", asOf: null, lesson: "Next.js 15 is in Maintenance LTS today, but its support window ends on October 21, 2026. The date in the question changes the answer." },
    { title: "Missing context", question: "Should I use proxy or middleware in Next.js 16?", asOf: null, lesson: "The answer depends on the runtime: proxy runs only on Node.js. TruthGraph asks instead of guessing. Add \"on the edge runtime\" to resolve it." },
    { title: "Sources disagree", question: "Will Node.js 27 be promoted to LTS?", asOf: null, lesson: "Two official Node.js pages disagree: the Release Working Group README says odd-numbered lines are never LTS; nodejs.org says every major from 27 is. A curator records the decision once in Curate." },
  ],
};

const reviewed = { knowledgeBaseId: base, authority: "primary" as const };
export const lifecycleSources: KnowledgeSource[] = [
  { ...reviewed, _id: "tg-source-next15-install", title: "Next.js 15 installation", publisher: "Vercel / Next.js", url: "https://nextjs.org/docs/15/app/getting-started/installation", publishedAt: null, reviewedAt: "2026-09-30" },
  { ...reviewed, _id: "tg-source-next15-upgrade", title: "Next.js 15 upgrade guide", publisher: "Vercel / Next.js", url: "https://nextjs.org/docs/app/guides/upgrading/version-15", publishedAt: null, reviewedAt: "2026-09-30" },
  { ...reviewed, _id: "tg-source-next16-upgrade", title: "Next.js 16 upgrade guide", publisher: "Vercel / Next.js", url: "https://nextjs.org/docs/app/guides/upgrading/version-16", publishedAt: null, reviewedAt: "2026-10-01" },
  { ...reviewed, _id: "tg-source-next-support", title: "Next.js support policy", publisher: "Vercel / Next.js", url: "https://nextjs.org/support-policy", publishedAt: null, reviewedAt: "2026-10-01" },
  { ...reviewed, _id: "tg-source-node-release-wg", title: "Node.js Release Working Group schedule", publisher: "Node.js Release Working Group", url: "https://github.com/nodejs/Release", publishedAt: null, reviewedAt: "2026-10-01" },
  { ...reviewed, _id: "tg-source-node-releases", title: "Node.js Releases", publisher: "Node.js / OpenJS Foundation", url: "https://nodejs.org/en/about/previous-releases", publishedAt: null, reviewedAt: "2026-10-01" },
  { ...reviewed, _id: "tg-source-node16-eol", title: "Bringing forward the End-of-Life Date for Node.js 16", publisher: "Node.js / OpenJS Foundation", url: "https://nodejs.org/en/blog/announcements/nodejs16-eol", publishedAt: "2022-06-08", reviewedAt: "2026-10-01" },
];

type Draft = Pick<Claim, "_id" | "sourceId" | "subject" | "predicate" | "value" | "statement" | "aliases"> & Partial<Pick<Claim, "version" | "effectiveFrom" | "effectiveUntil" | "conditions" | "relations" | "exclusive">>;
const claim = (draft: Draft): Claim => ({ knowledgeBaseId: base, exclusive: true, version: null, effectiveFrom: null, effectiveUntil: null, conditions: [], relations: [], ...draft });
const next = (major: number) => ({ subject: "Next.js", aliases: ["Next", "Next.js"], range: `>=${major}.0.0 <${major + 1}.0.0` });
const nodeRange = (range: string) => ({ subject: "Node.js", aliases: ["Node", "Node.js"], range });

const nextVersioned = (major: number, draft: Omit<Draft, "subject">) => claim({ ...draft, subject: "Next.js", version: next(major) });
const supportAliases = ["support", "supported", "still supported", "lts", "maintenance"];
const nextSupport = (major: number, id: string, value: string, statement: string, effectiveFrom: string | null, effectiveUntil: string | null) => claim({
  _id: id, sourceId: "tg-source-next-support", subject: "Next.js", predicate: "support status", value, statement, effectiveFrom, effectiveUntil, version: next(major),
  aliases: [...supportAliases, "security fixes"],
});
const nodePhase = (major: number, phase: string, value: string, statement: string, effectiveFrom: string, effectiveUntil: string | null) => claim({
  _id: `tg-claim-node${major}-${phase}`, sourceId: "tg-source-node-release-wg", subject: "Node.js", predicate: "support status", value, statement, effectiveFrom, effectiveUntil, version: nodeRange(`>=${major}.0.0 <${major + 1}.0.0`),
  aliases: [...supportAliases, "security updates"],
});

const nextClaims: Claim[] = [
  nextVersioned(15, { _id: "tg-claim-runtime-15", sourceId: "tg-source-next15-install", predicate: "minimum Node.js runtime", value: "18.18.0", statement: "Next.js 15 requires Node.js 18.18 or later. This is a framework minimum, not a Node.js lifecycle recommendation.", aliases: ["node", "nodejs", "runtime", "node version"] }),
  nextVersioned(16, { _id: "tg-claim-runtime-16", sourceId: "tg-source-next16-upgrade", predicate: "minimum Node.js runtime", value: "20.9.0", statement: "Next.js 16 requires Node.js 20.9.0 or later; Node.js 18 does not meet this framework requirement.", aliases: ["node", "nodejs", "runtime", "node version"] }),
  nextVersioned(15, { _id: "tg-claim-request-15", sourceId: "tg-source-next15-upgrade", predicate: "synchronous request API access", value: "temporary compatibility", statement: "Next.js 15 introduces asynchronous request APIs but temporarily permits synchronous access during migration.", aliases: ["cookies", "headers", "params", "request apis", "synchronous", "async"] }),
  nextVersioned(16, { _id: "tg-claim-request-16", sourceId: "tg-source-next16-upgrade", predicate: "synchronous request API access", value: "removed", statement: "Next.js 16 removes synchronous access to request-time APIs, including cookies, headers, params, and searchParams.", aliases: ["cookies", "headers", "params", "request apis", "synchronous", "async"] }),
  nextVersioned(15, { _id: "tg-claim-build-15", sourceId: "tg-source-next15-install", predicate: "default production bundler", value: "webpack", statement: "The Next.js 15 installation guide describes Turbopack production builds as opt-in; a standard next build uses webpack.", aliases: ["webpack", "turbopack", "bundler", "build pipeline"] }),
  nextVersioned(16, { _id: "tg-claim-build-16", sourceId: "tg-source-next16-upgrade", predicate: "default production bundler", value: "turbopack", statement: "Next.js 16 defaults to Turbopack. An unhandled custom webpack configuration can fail the default build; next build --webpack explicitly opts out.", aliases: ["webpack", "turbopack", "bundler", "build pipeline"] }),
  nextVersioned(15, { _id: "tg-claim-lint-15", sourceId: "tg-source-next15-install", predicate: "next lint command availability", value: "available", statement: "The Next.js 15 installation documentation includes the next lint command.", aliases: ["lint", "eslint", "biome", "linting"] }),
  nextVersioned(16, { _id: "tg-claim-lint-16", sourceId: "tg-source-next16-upgrade", predicate: "next lint command availability", value: "removed", statement: "Next.js 16 removes next lint and automatic build-time linting. Run ESLint or Biome directly.", aliases: ["lint", "eslint", "biome", "linting"] }),
  nextVersioned(15, { _id: "tg-claim-proxy-15", sourceId: "tg-source-next16-upgrade", predicate: "middleware and proxy convention", value: "middleware", statement: "Next.js 15 uses the middleware convention; the version 16 upgrade guide documents its subsequent deprecation.", aliases: ["middleware", "proxy", "edge"] }),
  nextVersioned(16, { _id: "tg-claim-proxy-16", sourceId: "tg-source-next16-upgrade", predicate: "middleware and proxy convention", value: "proxy", statement: "Next.js 16 deprecates middleware in favor of proxy; on the Node.js runtime, use the proxy convention.", aliases: ["middleware", "proxy", "edge"], conditions: [{ key: "runtime", value: "nodejs" }] }),
  nextVersioned(16, { _id: "tg-claim-proxy-16-edge", sourceId: "tg-source-next16-upgrade", predicate: "middleware and proxy convention", value: "middleware", statement: "Next.js 16 does not support the edge runtime in proxy, whose runtime is nodejs and cannot be configured; to keep using the edge runtime, keep using middleware.", aliases: ["middleware", "proxy", "edge"], conditions: [{ key: "runtime", value: "edge" }] }),
  nextVersioned(15, { _id: "tg-claim-image-ttl-15", sourceId: "tg-source-next16-upgrade", predicate: "default images.minimumCacheTTL", value: "60 seconds", statement: "Before Next.js 16, the default images.minimumCacheTTL was 60 seconds.", aliases: ["image", "images", "minimumcachettl", "cache ttl", "next/image"] }),
  nextVersioned(16, { _id: "tg-claim-image-ttl-16", sourceId: "tg-source-next16-upgrade", predicate: "default images.minimumCacheTTL", value: "4 hours (14400 seconds)", statement: "Next.js 16 changes the default images.minimumCacheTTL from 60 seconds to 4 hours (14400 seconds), reducing revalidation cost for images without cache-control headers.", aliases: ["image", "images", "minimumcachettl", "cache ttl", "next/image"] }),
  nextVersioned(16, { _id: "tg-claim-typescript-16", sourceId: "tg-source-next16-upgrade", predicate: "minimum TypeScript version", value: "5.1.0", statement: "Next.js 16 requires TypeScript 5.1.0 or later.", aliases: ["typescript", "ts", "tsc"] }),
  nextSupport(16, "tg-claim-next16-support-active", "Active LTS", "Next.js 16.x, released on October 21, 2025, is the Active LTS version and stays in Active LTS until the next major version is released.", "2025-10-21", null),
  nextSupport(15, "tg-claim-next15-support-active", "Active LTS", "Next.js 15.x was in Active LTS from its release on October 21, 2024 until Next.js 16 was released on October 21, 2025.", "2024-10-21", "2025-10-21"),
  nextSupport(15, "tg-claim-next15-support-maintenance", "Maintenance LTS", "Next.js 15.x is in Maintenance LTS from October 21, 2025, receiving only critical bug fixes and essential security updates; the policy keeps a major in Maintenance LTS until two years after its initial release on October 21, 2024.", "2025-10-21", "2026-10-21"),
  nextSupport(15, "tg-claim-next15-support-ended", "outside the LTS policy", "Under the support policy's two-year window from its October 21, 2024 release, Next.js 15.x is outside the LTS policy from October 21, 2026.", "2026-10-21", null),
  nextSupport(14, "tg-claim-next14-support", "unsupported", "The Next.js support policy lists 14.x, released on October 26, 2023, under Unsupported Versions.", null, null),
];

const nodeClaims: Claim[] = [
  claim({ _id: "tg-claim-node16-eol-planned", sourceId: "tg-source-node16-eol", subject: "Node.js", predicate: "end-of-life date", value: "April 2024", statement: "When Node.js 16 was released, its End-of-Life was planned for April 2024.", aliases: ["gallium", "end-of-life", "end of life", "eol"], version: nodeRange(">=16.0.0 <17.0.0") }),
  claim({ _id: "tg-claim-node16-eol-revised", sourceId: "tg-source-node16-eol", subject: "Node.js", predicate: "end-of-life date", value: "2023-09-11", statement: "The Node.js project brought the Node.js 16 End-of-Life forward by seven months to September 11, 2023, to coincide with the end of support for OpenSSL 1.1.1.", aliases: ["gallium", "end-of-life", "end of life", "eol"], version: nodeRange(">=16.0.0 <17.0.0"), relations: [{ kind: "corrects", targetId: "tg-claim-node16-eol-planned", reason: "The June 2022 announcement replaced the originally planned April 2024 End-of-Life date with September 11, 2023." }] }),
  nodePhase(18, "maintenance", "Maintenance LTS", "Node.js 18 (Hydrogen) was in Maintenance LTS from October 18, 2023 until April 30, 2025, receiving only critical bug fixes and security updates.", "2023-10-18", "2025-04-30"),
  nodePhase(18, "eol", "End-of-Life", "Node.js 18 reached End-of-Life on April 30, 2025 and no longer receives updates from the Node.js project.", "2025-04-30", null),
  nodePhase(20, "active", "Active LTS", "Node.js 20 (Iron) was in Active LTS from October 24, 2023 until October 22, 2024.", "2023-10-24", "2024-10-22"),
  nodePhase(20, "maintenance", "Maintenance LTS", "Node.js 20 was in Maintenance LTS from October 22, 2024 until April 30, 2026, receiving only critical bug fixes and security updates.", "2024-10-22", "2026-04-30"),
  nodePhase(20, "eol", "End-of-Life", "Node.js 20 reached End-of-Life on April 30, 2026 and no longer receives updates from the Node.js project.", "2026-04-30", null),
  nodePhase(22, "active", "Active LTS", "Node.js 22 (Jod) was in Active LTS from October 29, 2024 until October 21, 2025.", "2024-10-29", "2025-10-21"),
  nodePhase(22, "maintenance", "Maintenance LTS", "Node.js 22 is in Maintenance LTS from October 21, 2025 until its scheduled End-of-Life on April 30, 2027, receiving only critical bug fixes and security updates.", "2025-10-21", "2027-04-30"),
  nodePhase(22, "eol", "End-of-Life", "Node.js 22 is scheduled to reach End-of-Life on April 30, 2027; the schedule notes that dates are subject to change.", "2027-04-30", null),
  nodePhase(24, "active", "Active LTS", "Node.js 24 (Krypton) is in Active LTS from October 28, 2025 until October 20, 2026.", "2025-10-28", "2026-10-20"),
  nodePhase(24, "maintenance", "Maintenance LTS", "Node.js 24 is scheduled to be in Maintenance LTS from October 20, 2026 until its End-of-Life on April 30, 2028.", "2026-10-20", "2028-04-30"),
  nodePhase(24, "eol", "End-of-Life", "Node.js 24 is scheduled to reach End-of-Life on April 30, 2028; the schedule notes that dates are subject to change.", "2028-04-30", null),
  nodePhase(26, "current", "Current", "Node.js 26 is the Current release from May 5, 2026 and is scheduled to move to Active LTS on October 28, 2026.", "2026-05-05", "2026-10-28"),
  nodePhase(26, "active", "Active LTS", "Node.js 26 is scheduled to be in Active LTS from October 28, 2026 until October 20, 2027.", "2026-10-28", "2027-10-20"),
  nodePhase(26, "maintenance", "Maintenance LTS", "Node.js 26 is scheduled to be in Maintenance LTS from October 20, 2027 until its End-of-Life on April 30, 2029.", "2027-10-20", "2029-04-30"),
  claim({ _id: "tg-claim-node-odd-lts-wg", sourceId: "tg-source-node-release-wg", subject: "Node.js", predicate: "LTS promotion of odd-numbered release lines", value: "not promoted to LTS", statement: "The Node.js Release Working Group schedule states that odd-numbered release lines are not promoted to LTS and do not go through the Active LTS or Maintenance phases.", aliases: ["lts", "odd-numbered", "odd", "promoted", "long term support"] }),
  claim({ _id: "tg-claim-node-odd-lts-historical", sourceId: "tg-source-node-releases", subject: "Node.js", predicate: "LTS promotion of odd-numbered release lines", value: "not promoted to LTS", statement: "Up to Node.js 26, odd-numbered releases become unsupported after six months, while even-numbered releases move to Active LTS.", aliases: ["lts", "odd-numbered", "odd", "promoted", "long term support"], version: nodeRange("<27.0.0") }),
  claim({ _id: "tg-claim-node-annual-lts", sourceId: "tg-source-node-releases", subject: "Node.js", predicate: "LTS promotion of odd-numbered release lines", value: "promoted to LTS", statement: "Starting with Node.js 27, the release cycle is annual and every major version moves to LTS after its six-month Current phase (and six additional months of Alpha phase).", aliases: ["lts", "odd-numbered", "odd", "promoted", "long term support", "annual"], version: nodeRange(">=27.0.0") }),
];

export const lifecycleClaims: Claim[] = [...nextClaims, ...nodeClaims];
