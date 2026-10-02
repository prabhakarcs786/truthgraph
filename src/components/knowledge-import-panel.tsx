"use client";

import { useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, FileText, HardDrive, LoaderCircle, Search, Upload } from "lucide-react";
import { exportImportMarkdown, importFileByteLimit, importMetadataSchema, prepareImport, type PreparedImport } from "@/lib/knowledge-import";

export function downloadKnowledge(prepared: PreparedImport, format: "json" | "markdown") {
  const content = format === "json" ? JSON.stringify(prepared, null, 2) : exportImportMarkdown(prepared);
  const url = URL.createObjectURL(new Blob([content], { type: format === "json" ? "application/json" : "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url;
  anchor.download = `truthgraph-${prepared.catalog.knowledgeBases[0].title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.${format === "json" ? "json" : "md"}`;
  anchor.click(); URL.revokeObjectURL(url);
}

export type ImportSaveOptions = { adminCode: string; destination: "local" | "sanity"; question: string };
const fileTitle = (file?: File) => file?.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") || "";

export function KnowledgeImportPanel({ mode, initialFiles = [], initialInputKind = "files", onSave, onCancel }: { mode: "demo" | "live"; initialFiles?: File[]; initialInputKind?: "files" | "text"; onSave: (prepared: PreparedImport, options: ImportSaveOptions) => Promise<void>; onCancel: () => void }) {
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [title, setTitle] = useState(fileTitle(initialFiles[0]));
  const [description, setDescription] = useState("");
  const [publisher, setPublisher] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [adminCode, setAdminCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [inputKind, setInputKind] = useState<"files" | "text">(initialInputKind);
  const [pastedText, setPastedText] = useState("");
  const [destination, setDestination] = useState<"local" | "sanity">("local");
  const [firstQuestion, setFirstQuestion] = useState("");

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true);
    try {
      const selectedFiles = inputKind === "text" ? [new File([pastedText], "pasted-document.txt", { type: "text/plain" })] : files;
      const chosenTitle = title.trim() || fileTitle(selectedFiles[0]) || "Your documents";
      const metadata = importMetadataSchema.parse({ title: chosenTitle, description: description.trim() || `User-provided documents in ${chosenTitle}.`, publisher: publisher.trim() || "User-provided document", kind: synthetic ? "synthetic" : "real" });
      if (!selectedFiles.length || selectedFiles.length > 8) throw new Error("Choose between one and eight files.");
      if (selectedFiles.some((file) => !/\.(txt|md|markdown|json)$/i.test(file.name))) throw new Error("Choose text, Markdown, or structured JSON files. PDF and Office files are not supported by this importer.");
      const byteLimit = importFileByteLimit(selectedFiles);
      if (selectedFiles.reduce((total, file) => total + file.size, 0) > byteLimit) throw new Error(`The combined upload exceeds ${byteLimit / 1024} KB.`);
      const documents = await Promise.all(selectedFiles.map(async (file) => {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
        return { name: file.name, text };
      }));
      const result = await prepareImport(metadata, documents);
      setPrepared(result); setConfirmed(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The files could not be prepared."); }
    finally { setPending(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prepared || !confirmed) return;
    setPending(true); setError("");
    try { await onSave(prepared, { adminCode, destination, question: firstQuestion.trim() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The import could not be saved."); }
    finally { setPending(false); }
  }

  return <section className="tg-import-panel" aria-labelledby="import-heading">
    <div className="tg-section-line"><div><span className="tg-eyebrow">KNOWLEDGE BASE / {prepared ? "02 REVIEW" : "01 UPLOAD"}</span><h2 id="import-heading">{prepared ? "Review your knowledge base" : "Import knowledge base"}</h2></div><button type="button" className="tg-icon" title="Cancel import" aria-label="Cancel import" disabled={pending} onClick={onCancel}><ArrowLeft size={18} /></button></div>
    {!prepared ? <form onSubmit={prepare}>
      <details className="tg-sample-documents"><summary>Source-backed test documents</summary><ul>
        <li><a href="/sample-documents/football-rules.json" download><ArrowDownToLine size={15} aria-hidden="true" />Football rules JSON</a><span>IFAB Law changes by season, match type, and competition option.</span></li>
        <li><a href="/sample-documents/lifecycle.json" download><ArrowDownToLine size={15} aria-hidden="true" />Node.js and Next.js lifecycle JSON</a><span>Versions, dates, runtime conditions, corrections, and a source disagreement.</span></li>
        <li><a href="/sample-documents/python-lifecycle.json" download><ArrowDownToLine size={15} aria-hidden="true" />Python lifecycle JSON</a><span>Versioned support phases and the corrected Python 2.7 sunset date.</span></li>
        <li><a href="/sample-documents/pep-0373-excerpt.md" download><ArrowDownToLine size={15} aria-hidden="true" />PEP 373 Markdown excerpt</a><span>Public-domain original text for document upload and direct-upload AI.</span></li>
      </ul></details>
      <div className="tg-segmented" role="group" aria-label="Document input"><button type="button" aria-pressed={inputKind === "files"} onClick={() => setInputKind("files")}><Upload size={15} aria-hidden="true" />Upload files</button><button type="button" aria-pressed={inputKind === "text"} onClick={() => setInputKind("text")}><FileText size={15} aria-hidden="true" />Paste text</button></div>
      <fieldset disabled={pending} className="tg-import-fields">
        {inputKind === "files" ? <><div className="tg-file-picker"><Upload size={25} aria-hidden="true" /><label htmlFor="knowledge-files">Documents</label><input id="knowledge-files" type="file" multiple accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json" onChange={(event) => { const selected = Array.from(event.target.files || []); setFiles(selected); if (!title && selected[0]) setTitle(fileTitle(selected[0])); }} /><span>UTF-8 text or Markdown: up to 8 files / 256 KB total. One structured JSON bundle: up to 1 MB.</span></div>{files.length > 0 && <ul className="tg-import-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><FileText size={15} aria-hidden="true" /><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small></li>)}</ul>}</> : <><label htmlFor="pasted-document">Document text</label><textarea id="pasted-document" value={pastedText} onChange={(event) => setPastedText(event.target.value)} rows={7} minLength={10} maxLength={262144} required placeholder="Paste your document, notes, or policy text..." /></>}
        <label htmlFor="import-title">Knowledge base title</label><input id="import-title" value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={120} placeholder="From your filename, or choose a title" />
        <div className="tg-import-metadata"><div><label htmlFor="import-description">Purpose and scope</label><textarea id="import-description" value={description} onChange={(event) => setDescription(event.target.value)} minLength={10} maxLength={600} rows={2} placeholder="Optional" /></div><div><label htmlFor="import-publisher">Source owner or publisher</label><input id="import-publisher" value={publisher} onChange={(event) => setPublisher(event.target.value)} minLength={2} maxLength={120} placeholder="Optional / user-provided document" /></div></div>
        <label className="tg-import-checkbox"><input type="checkbox" checked={synthetic} onChange={(event) => setSynthetic(event.target.checked)} />These documents are synthetic test fixtures.</label>
      </fieldset><div className="tg-import-actions"><a href="/knowledge-base-template.json" download className="tg-text-link"><ArrowDownToLine size={15} aria-hidden="true" />JSON template</a><button className="tg-primary" type="submit" disabled={pending || (inputKind === "files" ? !files.length : pastedText.trim().length < 10)}>{pending ? <LoaderCircle size={17} className="tg-spin" aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}Review import</button></div>
    </form> : <form onSubmit={save}>
      <div className="tg-import-summary"><h3>{prepared.catalog.knowledgeBases[0].title}</h3><p>{prepared.catalog.knowledgeBases[0].description}</p><div><span>{prepared.catalog.sources.length} sources</span><span>{prepared.catalog.claims.length} claims</span><span>{destination === "local" ? "Destination: this browser" : "Destination: Sanity Content Lake"}</span></div></div>
      <p className="tg-notice">{prepared.uploads.length ? "Text documents are imported as literal, unverified excerpts. No dates, authority, versions, or correction relationships were inferred." : "Structured metadata is supplied by the JSON author. Check sources, applicability, and relationships before importing."}</p>
      <div className="tg-import-preview">{prepared.catalog.claims.map((claim, index) => <details key={claim._id}><summary><span>{index + 1}. {claim.subject} / {claim.predicate}</span><span className="tg-mono">{claim.relations.length} links</span></summary><p>{claim.statement}</p><small>Source: {prepared.catalog.sources.find((source) => source._id === claim.sourceId)?.title}</small></details>)}</div>
      {mode === "live" && <fieldset className="tg-destination"><legend>Save destination</legend><label><input type="radio" name="destination" value="local" checked={destination === "local"} onChange={() => setDestination("local")} /><HardDrive size={15} aria-hidden="true" />Private browser collection</label><label><input type="radio" name="destination" value="sanity" checked={destination === "sanity"} onChange={() => setDestination("sanity")} disabled={prepared.catalog.knowledgeBases[0].kind === "synthetic"} /><Upload size={15} aria-hidden="true" />Sanity shared collection</label></fieldset>}
      {destination === "sanity" ? <><p className="tg-notice">Saving stores the source records only. Build the Knowledge Base in Sanity, then verify its kb... mapping here. The name and description appear in the app's public knowledge-base list.</p><label className="tg-import-admin-label" htmlFor="import-admin-code">Knowledge-management code</label><input id="import-admin-code" type="password" value={adminCode} onChange={(event) => setAdminCode(event.target.value)} minLength={24} required autoComplete="off" /></> : <div className="tg-first-question"><label htmlFor="first-question"><Search size={16} aria-hidden="true" />First question <span>(optional / private preview)</span></label><input id="first-question" value={firstQuestion} onChange={(event) => setFirstQuestion(event.target.value)} minLength={5} maxLength={2000} placeholder="What would you like to know about these documents?" /></div>}
      <label className="tg-import-checkbox"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required />I reviewed the content and have permission to import it.</label>
      <div className="tg-import-actions"><button className="tg-secondary" type="button" onClick={() => setPrepared(null)} disabled={pending}><ArrowLeft size={15} aria-hidden="true" />Back</button><button className="tg-text-link" type="button" onClick={() => downloadKnowledge(prepared, "markdown")}><ArrowDownToLine size={15} aria-hidden="true" />Indexing file</button><button className="tg-primary" type="submit" disabled={pending || !confirmed}>{pending ? <LoaderCircle size={17} className="tg-spin" aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}{destination === "sanity" ? "Save to Sanity" : firstQuestion.trim() ? "Save and investigate" : "Save locally"}</button></div>
    </form>}
    {error && <p className="tg-error" role="alert">{error}</p>}
  </section>;
}