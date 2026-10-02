"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, GitBranch, KeyRound, LoaderCircle, RefreshCw, Save, Search, Trash2, Undo2 } from "lucide-react";
import { z } from "zod";
import { claimSchema, knowledgeBaseSchema, knowledgeSourceSchema, type Claim, type KnowledgeBase, type KnowledgeSource } from "@/lib/knowledge";

const budgetSchema = z.object({ documents: z.number(), limit: z.number(), remaining: z.number(), byBase: z.array(z.object({ id: z.string(), title: z.string(), documents: z.number() })) });
const overviewSchema = z.object({
  revision: z.string(),
  budget: budgetSchema,
  indexState: z.enum(["unmapped", "review-required", "operator-confirmed"]),
  sourceQuery: z.string(),
  knowledgeBase: knowledgeBaseSchema,
  sources: z.array(knowledgeSourceSchema),
  claims: z.array(z.intersection(claimSchema, z.object({ revision: z.string() }))),
  conflicts: z.array(z.object({ claimIds: z.tuple([z.string(), z.string()]), subject: z.string(), predicate: z.string() })),
  decisions: z.array(z.object({ claimId: z.string(), _key: z.string(), kind: z.string(), targetId: z.string(), reason: z.string() })),
});
export type DocumentBudget = z.infer<typeof budgetSchema>;
type Overview = z.infer<typeof overviewSchema>;
type EditableClaim = Overview["claims"][number];

export function BudgetMeter({ budget }: { budget: DocumentBudget }) {
  const used = Math.min(100, Math.round((budget.documents / budget.limit) * 100));
  return <div className="tg-budget" role="group" aria-label="Knowledge Base document budget">
    <div className="tg-budget-line"><strong>{budget.documents} / {budget.limit}</strong><span>project document budget ({budget.remaining} left)</span></div>
    <div className="tg-budget-bar" role="meter" aria-valuemin={0} aria-valuemax={budget.limit} aria-valuenow={budget.documents} aria-label="Documents used"><span style={{ width: `${used}%` }} className={used > 90 ? "full" : ""} /></div>
    <p>Conservative cap across all published dataset documents. It does not certify which documents Sanity has indexed. Larger corpora require a separate dataset Context MCP endpoint with embeddings; this app uses Knowledge Base retrieval.</p>
  </div>;
}

const describe = (claim: Claim) => [claim.version && `${claim.version.subject} ${claim.version.range}`, claim.effectiveFrom && `from ${claim.effectiveFrom}`, claim.effectiveUntil && `until ${claim.effectiveUntil}`, ...claim.conditions.map((condition) => `${condition.key} = ${condition.value}`)].filter(Boolean).join(" / ") || "No scope restriction";

function ClaimCard({ claim, source, label }: { claim: Claim; source?: KnowledgeSource; label: string }) {
  return <blockquote className="tg-curate-claim"><span className="tg-eyebrow">{label} / {claim._id}</span><p>{claim.statement}</p><small><strong>{claim.value}</strong> / {describe(claim)}</small>{source && <small>{source.url.startsWith("https:") ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={12} aria-hidden="true" /></a> : source.title} / {source.authority} source</small>}</blockquote>;
}

function ConflictCard({ pair, overview, pending, onDecide }: { pair: Overview["conflicts"][number]; overview: Overview; pending: boolean; onDecide: (body: object) => Promise<void> }) {
  const [winner, setWinner] = useState(pair.claimIds[1]);
  const [kind, setKind] = useState<"supersedes" | "corrects">("supersedes");
  const [reason, setReason] = useState("");
  const claims = pair.claimIds.map((id) => overview.claims.find((claim) => claim._id === id)!);
  const loser = pair.claimIds.find((id) => id !== winner)!;
  return <article className="tg-curate-conflict">
    <h3>{pair.subject} / {pair.predicate}</h3>
    <div className="tg-claim-pair">{claims.map((claim, index) => <ClaimCard key={claim._id} claim={claim} source={overview.sources.find((source) => source._id === claim.sourceId)} label={index ? "B" : "A"} />)}</div>
    <form onSubmit={(event) => { event.preventDefault(); void onDecide({ action: "add-relation", fromId: winner, toId: loser, kind, reason }); }}>
      <fieldset><legend>Which record takes precedence?</legend>{claims.map((claim, index) => <label key={claim._id}><input type="radio" name={`winner-${pair.claimIds.join("-")}`} checked={winner === claim._id} onChange={() => setWinner(claim._id)} />{index ? "B" : "A"}: {claim.value}</label>)}</fieldset>
      <label>Relationship<select value={kind} onChange={(event) => setKind(event.target.value as "supersedes" | "corrects")}><option value="supersedes">supersedes</option><option value="corrects">corrects</option></select></label>
      <label className="tg-curate-reason">Reason, shown to every future reader<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={600} rows={2} required placeholder="Why does this source take precedence?" /></label>
      <button className="tg-primary" type="submit" disabled={pending || reason.trim().length < 10}><CheckCircle2 size={15} aria-hidden="true" />Record decision</button>
    </form>
  </article>;
}

function ClaimEditor({ claim, pending, onSave }: { claim: EditableClaim; pending: boolean; onSave: (body: object) => Promise<void> }) {
  const [statement, setStatement] = useState(claim.statement);
  const [value, setValue] = useState(claim.value);
  const [from, setFrom] = useState(claim.effectiveFrom || "");
  const [until, setUntil] = useState(claim.effectiveUntil || "");
  const [confirming, setConfirming] = useState(false);
  const changed = statement !== claim.statement || value !== claim.value || from !== (claim.effectiveFrom || "") || until !== (claim.effectiveUntil || "");
  function save(event: FormEvent) { event.preventDefault(); void onSave({ action: "update-claim", claimId: claim._id, revision: claim.revision, statement, value, effectiveFrom: from || null, effectiveUntil: until || null }); }
  return <details className="tg-library-record"><summary><span><strong>{claim.subject}</strong><small>{claim.predicate}</small></span><span className="tg-mono">{claim.value}</span></summary>
    <form className="tg-curate-edit" onSubmit={save}>
      <label>Statement<textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={3} minLength={10} maxLength={1800} required /></label>
      <div><label>Value<input value={value} onChange={(event) => setValue(event.target.value)} maxLength={200} required /></label><label>Effective from<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Effective until (exclusive)<input type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></label></div>
      <p className="tg-mono">{claim._id} / {describe(claim)}</p>
      <div className="tg-import-actions">{confirming ? <><span>Delete this claim from Sanity?</span><button type="button" className="tg-secondary" onClick={() => setConfirming(false)}>Keep</button><button type="button" className="tg-primary tg-danger" disabled={pending} onClick={() => void onSave({ action: "delete-claim", claimId: claim._id, revision: claim.revision })}><Trash2 size={15} aria-hidden="true" />Confirm delete</button></> : <button type="button" className="tg-secondary" disabled={pending} onClick={() => setConfirming(true)}><Trash2 size={15} aria-hidden="true" />Delete</button>}<button type="submit" className="tg-primary" disabled={pending || !changed}><Save size={15} aria-hidden="true" />Save changes</button></div>
    </form>
  </details>;
}

export function CurationPanel({ mode, knowledgeBase }: { mode: "demo" | "live"; knowledgeBase?: KnowledgeBase }) {
  const [code, setCode] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [indexConfirmed, setIndexConfirmed] = useState(false);

  async function request(init?: RequestInit) {
    const response = await fetch(init ? "/api/admin" : `/api/admin?knowledgeBaseId=${encodeURIComponent(knowledgeBase!._id)}`, { ...init, headers: { "x-knowledge-admin-code": code, ...(init ? { "Content-Type": "application/json" } : {}) }, signal: AbortSignal.timeout(30_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.title || "Curation request failed.");
    return data;
  }
  async function load() {
    setPending(true); setError("");
    try { setOverview(overviewSchema.parse(await request())); }
    catch (cause) { setOverview(null); setError(cause instanceof Error ? cause.message : "Curation unavailable."); }
    finally { setPending(false); }
  }
  async function act(body: object) {
    setPending(true); setError(""); setNotice("");
    try { const data = await request({ method: "POST", body: JSON.stringify({ ...body, knowledgeBaseId: knowledgeBase!._id, expectedRevision: overview?.revision }) }); setNotice(z.object({ message: z.string() }).parse(data).message); setOverview(overviewSchema.parse(await request())); setIndexConfirmed(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The change was not confirmed."); }
    finally { setPending(false); }
  }

  if (mode !== "live") return <section className="tg-curate"><p className="tg-notice">Curation writes decisions to Sanity Content Lake, so it is available in live mode. In this sample, the Reasoning lab shows how recorded corrections change answers.</p></section>;
  if (!knowledgeBase || knowledgeBase.kind !== "real") return <section className="tg-curate"><p className="tg-notice">Choose a knowledge base stored in Sanity to curate it.</p></section>;
  const query = search.toLowerCase();
  const claims = overview?.claims.filter((claim) => `${claim._id} ${claim.subject} ${claim.predicate} ${claim.statement}`.toLowerCase().includes(query)) || [];
  const title = (id: string) => overview?.claims.find((claim) => claim._id === id)?.value ?? id;

  return <section className="tg-curate" aria-busy={pending}>
    <form className="tg-curate-unlock" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label><KeyRound size={15} aria-hidden="true" />Knowledge admin code<input type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" maxLength={200} required /></label>
      <button className="tg-primary" type="submit" disabled={pending || !code}>{pending ? <LoaderCircle size={15} className="tg-spin" aria-hidden="true" /> : overview ? <RefreshCw size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}{overview ? "Refresh" : "Open curation"}</button>
      <p>Decisions are saved as structured relationships on Sanity claims and apply to the next investigation. Readers never need this code.</p>
    </form>
    {error && <p className="tg-error" role="alert">{error}</p>}
    <p className="tg-notification" role="status" aria-live="polite">{notice}</p>
    {overview && <>
      <BudgetMeter budget={overview.budget} />
      <section className="tg-curate-section" aria-labelledby="index-review-heading">
        <div className="tg-section-line"><h2 id="index-review-heading">Index review</h2><span className="tg-state">{overview.indexState === "unmapped" ? "Mapping required" : overview.indexState === "review-required" ? "Review required" : "Operator confirmed"}</span></div>
        <p className="tg-curate-hint">{overview.knowledgeBase.contentChangedAt ? `Content changed: ${overview.knowledgeBase.contentChangedAt}. ` : "No content-change timestamp recorded. "}{overview.knowledgeBase.indexReviewedAt ? `Last operator review: ${overview.knowledgeBase.indexReviewedAt}.` : "No operator review recorded."}</p>
        <details className="tg-record"><summary>Dataset source query</summary><pre>{overview.sourceQuery}</pre></details>
        <a className="tg-text-link" href="https://www.sanity.io/welcome" target="_blank" rel="noreferrer">Open Sanity Context<ArrowUpRight size={15} aria-hidden="true" /></a>
        <form onSubmit={(event) => { event.preventDefault(); void act({ action: "confirm-index", confirmed: true }); }}>
          <label className="tg-import-checkbox"><input type="checkbox" checked={indexConfirmed} onChange={(event) => setIndexConfirmed(event.target.checked)} disabled={pending || overview.indexState === "unmapped"} />I checked the current entries in Sanity after rebuilding or applying source changes.</label>
          <button type="submit" className="tg-secondary" disabled={pending || !indexConfirmed || overview.indexState === "unmapped"}><CheckCircle2 size={15} aria-hidden="true" />Record index review</button>
        </form>
      </section>
      <section className="tg-curate-section" aria-labelledby="inbox-heading"><div className="tg-section-line"><h2 id="inbox-heading"><GitBranch size={18} aria-hidden="true" />Conflict inbox</h2><span className="tg-mono">{overview.conflicts.length} open</span></div>
        {overview.conflicts.length ? overview.conflicts.map((pair) => <ConflictCard key={pair.claimIds.join(":")} pair={pair} overview={overview} pending={pending} onDecide={act} />) : <p className="tg-empty-text">No unlinked claim pairs with overlapping scopes were found. Recorded decisions may still need review.</p>}
      </section>
      <section className="tg-curate-section" aria-labelledby="decisions-heading"><div className="tg-section-line"><h2 id="decisions-heading"><CheckCircle2 size={18} aria-hidden="true" />Recorded decisions</h2><span className="tg-mono">{overview.decisions.length}</span></div>
        {overview.decisions.map((decision) => <div className="tg-curate-decision" key={`${decision.claimId}:${decision._key}`}><p><strong>{title(decision.claimId)}</strong> {decision.kind} <strong>{title(decision.targetId)}</strong><small>{decision.claimId} → {decision.targetId}: {decision.reason}</small></p><button type="button" className="tg-secondary" disabled={pending} onClick={() => void act({ action: "remove-relation", claimId: decision.claimId, key: decision._key })}><Undo2 size={15} aria-hidden="true" />Undo</button></div>)}
      </section>
      <section className="tg-curate-section" aria-labelledby="claims-heading"><div className="tg-section-line"><h2 id="claims-heading">Claims</h2><span className="tg-mono">{overview.claims.length}</span></div>
        <label className="tg-curate-search"><Search size={15} aria-hidden="true" /><span className="tg-sr-only">Search claims</span><input type="search" placeholder="Search claims" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {claims.map((claim) => <ClaimEditor key={`${claim._id}:${claim.revision}`} claim={claim} pending={pending} onSave={act} />)}
        <p className="tg-curate-hint">New or changed claims require a Knowledge Base entry review. An answer uses canonical text only for record IDs cited by retrieved entries.</p>
      </section>
    </>}
  </section>;
}
