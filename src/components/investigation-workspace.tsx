"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, ChevronRight, CircleAlert, Compass, Database, FileSearch, FileText, GitBranch, HardDrive, Layers3, LoaderCircle, Play, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from "lucide-react";
import { z } from "zod";
import { claimSchema, investigationRequestSchema, investigationSchema, isShowcaseRequest, knowledgeBaseSchema, knowledgeSourceSchema, type Investigation, type InvestigationRequest, type KnowledgeBase, type KnowledgeCatalog } from "@/lib/knowledge";
import { investigationMarkdown } from "@/lib/investigation-export";
import { InvestigationResult } from "./investigation-result";
import { BudgetMeter, CurationPanel, type DocumentBudget } from "./curation-panel";
import { KnowledgeImportPanel, downloadKnowledge, type ImportSaveOptions } from "./knowledge-import-panel";
import { KnowledgeMappingForm } from "./knowledge-mapping-form";
import { useImportedKnowledge } from "./use-imported-knowledge";
import { investigateLocally } from "@/lib/sample-investigation";
import { type PreparedImport } from "@/lib/knowledge-import";
import { KnowledgeSourceShelf } from "./knowledge-source-shelf";

const librarySchema = z.object({ claims: z.array(claimSchema), sources: z.array(knowledgeSourceSchema) });
type View = "investigate" | "library" | "bases" | "curate";
const navigation = [{ id: "investigate", label: "Investigate", icon: FileSearch }, { id: "library", label: "Evidence library", icon: BookOpen }, { id: "bases", label: "Knowledge bases", icon: Layers3 }, { id: "curate", label: "Curate", icon: ShieldCheck }] as const;
const headings: Record<View, string> = { investigate: "Which answer applies?", library: "Evidence library", bases: "Knowledge bases", curate: "Curate knowledge" };
const emptyCatalog: KnowledgeCatalog = { knowledgeBases: [], sources: [], claims: [] };
type Shared = { knowledgeBaseId: string; question: string; asOf: string };

export function InvestigationWorkspace({ mode, knowledgeBases: initialKnowledgeBases, sample, catalogError, budget: initialBudget = null, shared }: { mode: "demo" | "live"; knowledgeBases: KnowledgeBase[]; sample: KnowledgeCatalog | null; catalogError: string | null; budget?: DocumentBudget | null; shared?: Shared }) {
  const imported = useImportedKnowledge(sample || emptyCatalog);
  const [remoteBases, setRemoteBases] = useState(initialKnowledgeBases);
  const knowledgeBases = mode === "demo" ? imported.catalog?.knowledgeBases || initialKnowledgeBases : [...remoteBases, ...(imported.catalog?.knowledgeBases || []).filter((base) => !remoteBases.some((remote) => remote._id === base._id))];
  const sharedBase = shared && initialKnowledgeBases.some((base) => base._id === shared.knowledgeBaseId) ? shared : null;
  const [view, setView] = useState<View>("investigate");
  const [selectedId, setSelectedId] = useState(sharedBase?.knowledgeBaseId || "");
  const [question, setQuestion] = useState(sharedBase?.question || "");
  const [asOf, setAsOf] = useState(sharedBase?.asOf || "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(sharedBase?.question ? "Shared question loaded. Press Investigate to run it." : "");
  const [budget, setBudget] = useState(initialBudget);
  const [result, setResult] = useState<Investigation | null>(null);
  const [resultKey, setResultKey] = useState("");
  const [history, setHistory] = useState<{ request: InvestigationRequest; result: Investigation }[]>([]);
  const [library, setLibrary] = useState<(z.infer<typeof librarySchema> & { id: string }) | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [savedImports, setSavedImports] = useState<PreparedImport[]>([]);
  const [removeTarget, setRemoveTarget] = useState<KnowledgeBase | null>(null);
  const [sharePending, setSharePending] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState("");
  const [listError, setListError] = useState(catalogError);
  const [initialFiles, setInitialFiles] = useState<File[]>([]);
  const [initialInputKind, setInitialInputKind] = useState<"files" | "text">("files");
  const [useUploadAi, setUseUploadAi] = useState(false);
  const [uploadConsent, setUploadConsent] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const searchText = useDeferredValue(search).toLowerCase();
  const controller = useRef<AbortController | null>(null);
  const removeDialog = useRef<HTMLDialogElement>(null);
  const shareDialog = useRef<HTMLDialogElement>(null);
  const selected = knowledgeBases.find((base) => base._id === selectedId);
  const selectedImport = imported.imports.find((item) => item.catalog.knowledgeBases[0]._id === selectedId);
  const currentRequest = { knowledgeBaseId: selectedId, question, ...(asOf ? { asOf } : {}) };
  const stale = Boolean(result && resultKey !== JSON.stringify(currentRequest));
  const records = mode === "demo" || selectedImport ? imported.catalog?.claims.filter((claim) => claim.knowledgeBaseId === selectedId) || [] : library?.id === selectedId ? library.claims : result?.knowledgeBase._id === selectedId ? result.evidence.map((item) => item.claim) : [];
  const visibleRecords = records.filter((claim) => (!sourceFilter || claim.sourceId === sourceFilter) && `${claim.subject} ${claim.predicate} ${claim.statement}`.toLowerCase().includes(searchText));
  const sources = mode === "demo" || selectedImport ? imported.catalog?.sources.filter((source) => source.knowledgeBaseId === selectedId) || [] : library?.id === selectedId ? library.sources : result?.knowledgeBase._id === selectedId ? result.sources : [];
  const modeLabel = selectedImport ? useUploadAi ? "Direct upload / AI" : "Private / local preview" : mode === "live" ? "Live / Sanity Context" : "Sample / local retrieval";
  const showcase = selected && !selectedImport ? selected.showcase : [];
  const publicShowcase = Boolean(selected && !selectedImport && selected.kind === "real" && isShowcaseRequest(selected, { question, asOf }));
  const flagship = knowledgeBases.find((base) => base.showcase.length > 0 && (mode === "demo" || base.mcpId));
  const queryDisabled = pending || !selected || (selectedImport ? useUploadAi && (mode !== "live" || !code || !uploadConsent) : mode === "live" && ((!code && !publicShowcase) || !selected.mcpId));
  const blockedReason = pending || !selected || selectedImport || mode !== "live" ? null : !selected.mcpId ? "This collection is waiting for its Sanity Knowledge Base index. Try another collection's guided tour for now." : !code && !publicShowcase ? "Custom questions need an access code. The guided-tour questions above run without one." : null;

  function changeBase(id: string) { setSelectedId(id); setQuestion(""); setAsOf(""); setError(""); setSearch(""); setSourceFilter(""); setResult(null); setUseUploadAi(false); setUploadConsent(false); }

  function startImport(files: File[] = [], inputKind: "files" | "text" = "files") { setInitialFiles(files); setInitialInputKind(inputKind); setView("bases"); setImporting(true); setError(""); }

  async function investigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runInvestigation(currentRequest);
  }

  async function runInvestigation(request: InvestigationRequest, immediateImport?: PreparedImport) {
    setError(""); setNotice("");
    const parsed = investigationRequestSchema.safeParse(request);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the question and context."); return; }
    setPending(true); controller.current = new AbortController();
    try {
      let investigation: Investigation;
      const upload = immediateImport || selectedImport;
      if (upload && (!useUploadAi || immediateImport)) {
        investigation = investigationSchema.parse(investigateLocally(parsed.data, upload.catalog));
        investigation.trace.unshift({ stage: "Browser import", detail: "This question was evaluated locally against your saved upload. No uploaded content was sent to a server or a model." });
      } else {
        if (upload && !uploadConsent) throw new Error("Consent is required before sending this upload to the model provider.");
        const response = await fetch(upload ? "/api/investigate-upload" : "/api/investigate", { method: "POST", headers: { "Content-Type": "application/json", ...(mode === "live" && code ? { "x-judge-code": code } : {}) }, body: JSON.stringify(upload ? { request: parsed.data, prepared: upload, consent: uploadConsent } : parsed.data), signal: controller.current.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.title || "Investigation failed.");
        investigation = investigationSchema.parse(data);
      }
      setResult(investigation); setResultKey(JSON.stringify(parsed.data));
      setHistory((previous) => [{ request: parsed.data, result: investigation }, ...previous].slice(0, 5));
      setNotice("Investigation complete.");
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") setNotice("Investigation cancelled.");
      else setError(cause instanceof Error ? cause.message : "The server could not be reached.");
    } finally { setPending(false); controller.current = null; }
  }

  async function loadLibrary() {
    if (mode === "demo" || selectedImport) { setNotice("Evidence loaded from this browser's current collection."); return; }
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/evidence?knowledgeBaseId=${encodeURIComponent(selectedId)}`, { headers: mode === "live" && code ? { "x-judge-code": code } : {}, signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.title || "Evidence unavailable.");
      setLibrary({ ...librarySchema.parse(data), id: selectedId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evidence unavailable."); }
    finally { setPending(false); }
  }

  async function refreshBases() {
    if (mode === "demo") { setNotice("Local imports are synchronized between tabs in this browser."); return; }
    setPending(true); setError("");
    try {
      const response = await fetch("/api/knowledge-bases", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.title || "Knowledge bases unavailable.");
      const parsed = z.object({ knowledgeBases: z.array(knowledgeBaseSchema), budget: z.object({ documents: z.number(), limit: z.number(), remaining: z.number(), byBase: z.array(z.object({ id: z.string(), title: z.string(), documents: z.number() })) }).optional() }).parse(data);
      const bases = parsed.knowledgeBases;
      setRemoteBases(bases); setListError(null); if (parsed.budget) setBudget(parsed.budget);
      if (!bases.some((base) => base._id === selectedId)) changeBase(bases[0]?._id || "");
      setNotice("Knowledge bases refreshed from Sanity.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Refresh failed."); }
    finally { setPending(false); }
  }

  async function saveImport(prepared: PreparedImport, options: ImportSaveOptions) {
    let base = prepared.catalog.knowledgeBases[0];
    if (options.destination === "local") {
      imported.add(prepared);
      setNotice("Knowledge base saved in this browser. You can investigate it now; no Sanity upload was made.");
    } else {
      const response = await fetch("/api/knowledge-bases", { method: "POST", headers: { "Content-Type": "application/json", "x-knowledge-admin-code": options.adminCode }, body: JSON.stringify(prepared), signal: AbortSignal.timeout(40_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.title || "The save could not be confirmed. Refresh knowledge bases before retrying.");
      base = knowledgeBaseSchema.parse(data.knowledgeBase);
      setRemoteBases((previous) => [...previous.filter((item) => item._id !== base._id), base]);
      setSavedImports((previous) => [...previous, prepared]); setListError(null);
      setNotice("Source records saved to Sanity. Build entries in the Context Dashboard, then verify the kb... mapping below.");
    }
    setImporting(false); changeBase(base._id); setView(options.destination === "local" ? "investigate" : "bases");
    if (options.destination === "local" && options.question) { setQuestion(options.question); await runInvestigation({ knowledgeBaseId: base._id, question: options.question }, prepared); }
  }

  function confirmRemove() {
    if (!removeTarget) return;
    try { imported.remove(removeTarget._id); setHistory((previous) => previous.filter((item) => item.request.knowledgeBaseId !== removeTarget._id)); if (selectedId === removeTarget._id) changeBase(""); setNotice("Local import removed. No Sanity records were changed."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The import could not be removed."); }
    removeDialog.current?.close(); setRemoveTarget(null);
  }

  async function runScenario(scenario: KnowledgeBase["showcase"][number]) {
    setQuestion(scenario.question); setAsOf(scenario.asOf || "");
    await runInvestigation({ knowledgeBaseId: selectedId, question: scenario.question, ...(scenario.asOf ? { asOf: scenario.asOf } : {}) });
  }

  async function shareResult() {
    if (!result || !resultKey) return;
    if (result.shareReceipt) { setPublishedUrl(""); shareDialog.current?.showModal(); return; }
    const request = investigationRequestSchema.parse(JSON.parse(resultKey));
    const url = new URL("/", window.location.origin);
    url.search = new URLSearchParams({ kb: request.knowledgeBaseId, q: request.question, ...(request.asOf ? { asOf: request.asOf } : {}) }).toString();
    try { await navigator.clipboard.writeText(url.toString()); setNotice(isShowcaseRequest(result.knowledgeBase, request) ? "Share link copied. Guided-tour questions run without an access code." : "Share link copied. Recipients need an access code to run custom questions."); }
    catch { setError("The share link could not be copied."); }
  }

  async function publishSnapshot() {
    if (!result?.shareReceipt) return;
    setSharePending(true); setError("");
    try {
      const response = await fetch("/api/investigations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true, investigation: result }), signal: AbortSignal.timeout(25_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.title || "The snapshot could not be saved.");
      const saved = z.object({ path: z.string().regex(/^\/investigations\/[a-f0-9-]{36}$/) }).parse(data);
      const url = new URL(saved.path, window.location.origin).toString();
      setPublishedUrl(url);
      try { await navigator.clipboard.writeText(url); setNotice("Snapshot saved in Sanity. Share link copied."); }
      catch { setNotice("Snapshot saved in Sanity. Its link is available in the share dialog."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Snapshot publication failed."); shareDialog.current?.close(); }
    finally { setSharePending(false); }
  }

  async function exportResult(copy: boolean) {
    if (!result) return;
    const markdown = investigationMarkdown(result);
    try {
      if (copy) { await navigator.clipboard.writeText(markdown); setNotice("Investigation copied."); }
      else {
        const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "truthgraph-investigation.md"; anchor.click(); URL.revokeObjectURL(url); setNotice("Investigation downloaded.");
      }
    } catch { setError("Export failed. Try downloading the investigation."); }
  }

  return <div className="tg-shell">
    <aside className="tg-sidebar"><Link className="tg-brand" href="/" aria-label="TruthGraph home"><Image src="/icon" width={36} height={36} alt="" unoptimized /><span>truthgraph<small>EVIDENCE WORKSPACE</small></span></Link><div className="tg-sidebar-label"><GitBranch size={15} aria-hidden="true" />Connected knowledge</div><nav aria-label="Workspace">{navigation.map((item) => <button key={item.id} type="button" className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => { setView(item.id); setError(""); }}><item.icon size={18} aria-hidden="true" />{item.label}</button>)}</nav><div className="tg-sidebar-bottom"><strong><span>S</span> Sanity Context</strong><a href="https://dev.to/challenges/sanity-2026-09-16" target="_blank" rel="noreferrer">Path One / challenge brief<ArrowUpRight size={14} aria-hidden="true" /></a></div></aside>
    <div className="tg-body"><header className="tg-topbar"><span>Personal workspace<ChevronRight size={14} aria-hidden="true" /><strong>{navigation.find((item) => item.id === view)?.label}</strong></span><span className={`tg-mode ${selectedImport ? "upload" : mode}`}><span />{modeLabel}</span></header><main id="main" className="tg-main">
      <div className="tg-page-heading"><div><span className="tg-eyebrow">KNOWLEDGE INVESTIGATION</span><h1>{headings[view]}</h1></div><div className="tg-page-actions"><span className="tg-page-mark"><Database size={15} aria-hidden="true" />{knowledgeBases.length} {knowledgeBases.length === 1 ? "corpus" : "corpora"}</span><button type="button" className="tg-secondary" disabled={pending} onClick={() => startImport()}><Upload size={16} aria-hidden="true" />Import knowledge base</button></div></div>
      {listError && <p className="tg-error" role="alert"><CircleAlert size={18} aria-hidden="true" />{listError}</p>}
      {imported.error && <p className="tg-error" role="alert"><CircleAlert size={18} aria-hidden="true" />{imported.error}</p>}
      <div className="tg-corpus-bar"><label htmlFor="knowledge-base"><Layers3 size={15} aria-hidden="true" />Knowledge base</label><select id="knowledge-base" value={selectedId} disabled={pending || !knowledgeBases.length} onChange={(event) => changeBase(event.target.value)}><option value="" disabled>Choose a collection</option>{knowledgeBases.map((base) => <option key={base._id} value={base._id}>{base.title}{base.kind === "synthetic" ? " (synthetic)" : ""}</option>)}</select>{selected && <span className="tg-collection-state">{selectedImport ? "Private collection" : selected.kind === "synthetic" ? "Synthetic" : mode === "demo" ? "Sample collection" : selected.mcpId ? "MCP mapped" : "Awaiting index"}</span>}{mode === "live" && (!selectedImport || useUploadAi) && <label className="tg-access-label">Access code<input aria-label="Access code" placeholder="For custom questions" type="password" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" maxLength={200} /></label>}</div>
      {selected?.kind === "synthetic" && <p className="tg-synthetic"><CircleAlert size={16} aria-hidden="true" />Synthetic reasoning fixtures. This corpus contains invented test material, not real-world evidence.</p>}
      {mode === "live" && selected && !selectedImport && !selected.mcpId && <p className="tg-notice">This corpus is stored in Sanity but has no verified Knowledge Base mapping. Build the entries and connect its kb... ID in Knowledge bases before investigating.</p>}

      {view === "investigate" && <div className="tg-desk-layout"><div className="tg-desk-primary">
        {!selected ? <>{flagship && <section className="tg-tour-start" aria-labelledby="tour-start-heading"><div><span className="tg-eyebrow">GUIDED TOUR / {mode === "live" ? "LIVE SANITY CONTEXT / NO CODE NEEDED" : "LOCAL SAMPLE"}</span><h2 id="tour-start-heading">See where keyword search gives the wrong answer</h2><p>{flagship.showcase.length} real questions from the {flagship.title}: {flagship.showcase.map((scenario) => scenario.title.toLowerCase()).join(", ")}. Each is a case where the best-matching rule is not the one that applies.</p></div><button type="button" className="tg-primary" onClick={() => changeBase(flagship._id)}><Compass size={17} aria-hidden="true" />Start the guided tour<ArrowRight size={17} aria-hidden="true" /></button></section>}<section className={`tg-quick-upload ${dragging ? "is-dragging" : ""}`} aria-labelledby="start-heading" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const files = Array.from(event.dataTransfer.files); if (files.length) startImport(files); }}><div className="tg-upload-index"><span className="tg-eyebrow">01 / YOUR MATERIAL</span><HardDrive size={18} aria-hidden="true" /></div><div className="tg-document-symbol"><FileText size={35} strokeWidth={1.2} aria-hidden="true" /></div><h2 id="start-heading">Add your documents</h2><p className="tg-upload-formats">TXT, Markdown, or structured JSON</p><label htmlFor="quick-documents" className="tg-primary"><Upload size={17} aria-hidden="true" />Choose documents</label><input className="tg-file-control" id="quick-documents" type="file" multiple accept=".txt,.md,.markdown,.json" onChange={(event) => { const files = Array.from(event.target.files || []); if (files.length) startImport(files); }} /><button className="tg-text-link" type="button" onClick={() => startImport([], "text")}><FileText size={14} aria-hidden="true" />Or paste text<ArrowRight size={14} aria-hidden="true" /></button><div className="tg-upload-bottom"><span>Local preview / no account needed</span><span>Text 256 KB / JSON 1 MB</span></div></section></> : <>
        {selectedImport && <div className="tg-analysis-options"><div className="tg-segmented" role="group" aria-label="Analysis mode"><button type="button" aria-pressed={!useUploadAi} onClick={() => { setUseUploadAi(false); setResult(null); }} disabled={pending}><HardDrive size={15} aria-hidden="true" />Private preview</button><button type="button" aria-pressed={useUploadAi} onClick={() => { setUseUploadAi(true); setResult(null); }} disabled={pending || mode !== "live"} title={mode === "live" ? "Analyze this upload using the configured model" : "Requires live mode and a server-side model key"}><Sparkles size={15} aria-hidden="true" />AI on this upload</button></div>{useUploadAi && <label className="tg-upload-consent"><input type="checkbox" checked={uploadConsent} onChange={(event) => setUploadConsent(event.target.checked)} />Send this collection's content and my question to the configured model provider. This does not publish it to Sanity.</label>}</div>}
        {showcase.length > 0 && <section className="tg-tour" aria-labelledby="tour-heading"><div className="tg-tour-head"><span className="tg-eyebrow">GUIDED TOUR{mode === "live" ? " / NO ACCESS CODE NEEDED" : ""}</span><h2 id="tour-heading">{showcase.length} questions where keyword search goes wrong</h2></div><ol>{showcase.map((scenario, index) => <li key={`${scenario.question}|${scenario.asOf ?? ""}`}><button type="button" aria-pressed={question === scenario.question && asOf === (scenario.asOf || "")} disabled={pending || (mode === "live" && !selected.mcpId)} onClick={() => void runScenario(scenario)}><span className="tg-mono">{String(index + 1).padStart(2, "0")} / {scenario.title}</span><strong>{scenario.question}</strong><small>{scenario.lesson}</small><span className="tg-tour-run"><Play size={13} aria-hidden="true" />Run</span></button></li>)}</ol></section>}
        <form className="tg-composer" onSubmit={investigate}><label htmlFor="question"><Search size={15} aria-hidden="true" />Your question</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What would you like to know?" minLength={5} maxLength={2000} rows={3} required disabled={pending} /><div className="tg-composer-bottom"><label className="tg-date-label" htmlFor="as-of">As of <span>(optional)</span><input id="as-of" type="date" value={asOf} disabled={pending} onChange={(event) => setAsOf(event.target.value)} /></label><div className="tg-submit"><button type="submit" className="tg-primary" disabled={queryDisabled} aria-describedby={blockedReason ? "query-blocked" : undefined}>{pending ? <LoaderCircle size={17} className="tg-spin" aria-hidden="true" /> : <Search size={17} aria-hidden="true" />}{pending ? "Investigating..." : "Investigate"}<ArrowRight size={17} aria-hidden="true" /></button>{pending && <button type="button" className="tg-icon" aria-label="Cancel investigation" title="Cancel investigation" onClick={() => controller.current?.abort()}><X size={19} /></button>}</div></div>{blockedReason && <p id="query-blocked" className="tg-query-blocked">{blockedReason}</p>}</form>
        {!result && selected.suggestedQuestions.length > 0 && <div className="tg-suggestions"><span className="tg-eyebrow">FROM THIS COLLECTION</span>{selected.suggestedQuestions.map((suggestion) => <button key={suggestion} type="button" disabled={pending} onClick={() => { setQuestion(suggestion); document.getElementById("question")?.focus(); }}>{suggestion}<ArrowUpRight size={15} aria-hidden="true" /></button>)}</div>}
        <div aria-busy={pending}>{result ? <InvestigationResult result={result} stale={stale} exportResult={(copy) => { void exportResult(copy); }} shareResult={selectedImport ? undefined : () => { void shareResult(); }} /> : <section className="tg-empty"><div className="tg-empty-mark"><FileSearch size={25} aria-hidden="true" /></div><h2>Ready for a question</h2><p>{selected.description}</p><div className="tg-empty-meta"><span><BookOpen size={14} aria-hidden="true" />{records.length} loaded claims</span><span><GitBranch size={14} aria-hidden="true" />{selectedImport ? "Your documents / private collection" : "Sources / applicability / relationships"}</span></div></section>}</div></>}
        {history.length > 1 && <section className="tg-history"><h2>Recent investigations</h2>{history.slice(1).map((item, index) => <button type="button" key={index} onClick={() => { setSelectedId(item.request.knowledgeBaseId); setQuestion(item.request.question); setAsOf(item.request.asOf || ""); setResult(item.result); setResultKey(JSON.stringify(item.request)); }}><span>{item.request.question}</span><span className="tg-mono">{item.result.status}</span><ChevronRight size={15} aria-hidden="true" /></button>)}</section>}
      </div><KnowledgeSourceShelf base={selected} sources={sources} claims={records} collections={knowledgeBases} onSelect={changeBase} onInspect={(id) => { setSourceFilter(id); setSearch(""); setView("library"); if (mode === "live" && !selectedImport) void loadLibrary(); }} /></div>}

      {view === "library" && <section className="tg-library"><div className="tg-library-toolbar"><label><Search size={17} aria-hidden="true" /><span className="tg-sr-only">Search evidence</span><input type="search" placeholder="Search claims and subjects" value={search} onChange={(event) => setSearch(event.target.value)} /></label>{sourceFilter && <button className="tg-text-link" type="button" onClick={() => setSourceFilter("")}><X size={14} aria-hidden="true" />Clear source filter</button>}<button type="button" className="tg-secondary" onClick={loadLibrary} disabled={pending || !selected}><RefreshCw size={15} aria-hidden="true" />{pending ? "Loading..." : "Refresh evidence"}</button></div>{mode === "live" && !selectedImport && library?.id !== selectedId && <p className="tg-notice">Evidence records have not been loaded for this session.</p>}{visibleRecords.map((claim) => <details className="tg-library-record" key={claim._id}><summary><span><strong>{claim.subject}</strong><small>{claim.predicate}</small></span><span className="tg-mono">{claim.value}</span><ChevronRight size={16} aria-hidden="true" /></summary><p>{claim.statement}</p><div className="tg-library-meta"><span>Source: {claim.sourceId}</span><span>{claim.version ? `${claim.version.subject} ${claim.version.range}` : "No version restriction"}</span><span>{claim.relations.length} relationships</span></div><pre>{JSON.stringify(claim, null, 2)}</pre></details>)}{visibleRecords.length === 0 && <p className="tg-empty-text">No matching evidence.</p>}</section>}

      {view === "curate" && <CurationPanel key={selectedId} mode={mode} knowledgeBase={selectedImport ? undefined : selected} />}
      {view === "bases" && importing && <KnowledgeImportPanel mode={mode} initialFiles={initialFiles} initialInputKind={initialInputKind} onSave={saveImport} onCancel={() => setImporting(false)} />}
      {view === "bases" && !importing && <section className="tg-base-list"><div className="tg-base-toolbar"><span className="tg-eyebrow">YOUR CONTENT COLLECTIONS</span><button className="tg-secondary" type="button" onClick={refreshBases} disabled={pending}><RefreshCw size={15} aria-hidden="true" />Refresh knowledge bases</button></div>{budget && mode === "live" && <BudgetMeter budget={budget} />}{knowledgeBases.map((base) => {
        const saved = [...imported.imports, ...savedImports].find((item) => item.catalog.knowledgeBases[0]._id === base._id);
        const isLocal = imported.imports.some((item) => item.catalog.knowledgeBases[0]._id === base._id);
        return <article key={base._id}><div className="tg-base-icon"><Layers3 size={22} aria-hidden="true" /></div><div><h2>{base.title}</h2><p>{base.description}</p><dl><div><dt>Corpus</dt><dd>{base.kind === "synthetic" ? "Synthetic fixtures" : "Real source material"}</dd></div><div><dt>Storage</dt><dd>{isLocal ? "Imported / this browser only" : mode === "demo" ? "Bundled sample" : "Sanity Content Lake"}</dd></div><div><dt>Sanity KB mapping</dt><dd>{base.mcpId || (mode === "demo" || isLocal ? "Not applicable to local preview" : "Awaiting index and verified mapping")}</dd></div></dl><div className="tg-base-actions"><button type="button" className="tg-text-link" onClick={() => { changeBase(base._id); setView("investigate"); }} disabled={mode === "live" && !isLocal && !base.mcpId}>Investigate this knowledge base<ArrowRight size={15} aria-hidden="true" /></button>{saved && <><button type="button" className="tg-icon" title="Download knowledge base JSON" aria-label={`Download ${base.title} JSON`} onClick={() => downloadKnowledge(saved, "json")}><ArrowDownToLine size={17} /></button><button type="button" className="tg-text-link" onClick={() => downloadKnowledge(saved, "markdown")}>Indexing file<ArrowDownToLine size={14} aria-hidden="true" /></button></>}{isLocal && <button type="button" className="tg-icon" title="Remove local knowledge base" aria-label={`Remove ${base.title}`} onClick={() => { setRemoveTarget(base); removeDialog.current?.showModal(); }}><Trash2 size={16} /></button>}</div>{mode === "live" && !isLocal && base.kind === "real" && <KnowledgeMappingForm key={`${base._id}-${base.mcpId}`} base={base} onMapped={(updated) => setRemoteBases((previous) => previous.map((item) => item._id === updated._id ? updated : item))} />}</div></article>;
      })}<a className="tg-secondary" href="https://www.sanity.io/manage" target="_blank" rel="noreferrer">Manage in Sanity<ArrowUpRight size={16} aria-hidden="true" /></a></section>}
      {error && <p className="tg-error" role="alert"><CircleAlert size={18} aria-hidden="true" />{error}</p>}<p className="tg-notification" role="status" aria-live="polite">{notice}</p><footer className="tg-footer"><span>{selectedImport ? useUploadAi ? "Direct upload analysis / no Sanity indexing" : "Private preview / no remote calls" : mode === "demo" ? "Sample mode / no MCP or model calls" : "Sanity Context / read-only retrieval"}</span><span>Evidence strength is not a guarantee of truth.</span></footer>
    </main></div>
    <dialog ref={removeDialog} className="tg-remove-dialog" aria-labelledby="remove-title"><div className="tg-section-line"><h2 id="remove-title">Remove local knowledge base?</h2><button className="tg-icon" type="button" title="Close dialog" aria-label="Close dialog" onClick={() => removeDialog.current?.close()}><X size={17} /></button></div><p>{removeTarget?.title} and its original uploaded text will be removed from this browser. Sanity records are not changed.</p><div className="tg-import-actions"><button className="tg-secondary" type="button" onClick={() => removeDialog.current?.close()}>Cancel</button><button className="tg-primary" type="button" onClick={confirmRemove}><Trash2 size={15} aria-hidden="true" />Remove local import</button></div></dialog>
    <dialog ref={shareDialog} className="tg-remove-dialog" aria-labelledby="share-title">
      <div className="tg-section-line"><h2 id="share-title">Publish investigation snapshot?</h2><button type="button" className="tg-icon" title="Close share dialog" aria-label="Close share dialog" onClick={() => shareDialog.current?.close()}><X size={17} /></button></div>
      <p>The question, answer, retrieved claims, sources, comparison, and trace will be saved in Sanity and accessible without an access code. Do not publish confidential material.</p>
      {publishedUrl ? <p role="status"><a className="tg-text-link" href={publishedUrl} target="_blank" rel="noreferrer">Open saved investigation<ArrowUpRight size={15} aria-hidden="true" /></a></p> : <div className="tg-import-actions"><button type="button" className="tg-secondary" onClick={() => shareDialog.current?.close()} disabled={sharePending}>Cancel</button><button type="button" className="tg-primary" onClick={() => void publishSnapshot()} disabled={sharePending}>{sharePending && <LoaderCircle size={15} className="tg-spin" aria-hidden="true" />}Publish and copy link</button></div>}
    </dialog>
  </div>;
}