"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Copy, Link2, LoaderCircle } from "lucide-react";
import { knowledgeBaseSchema, type KnowledgeBase } from "@/lib/knowledge";

export function KnowledgeMappingForm({ base, onMapped }: { base: KnowledgeBase; onMapped: (base: KnowledgeBase) => void }) {
  const [mcpId, setMcpId] = useState(base.mcpId || "");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sourceQuery = `*[_type == "tgClaim" && knowledgeBase._ref == ${JSON.stringify(base._id)}]{..., "source": source->{_id,title,publisher,url,fileName,authority,publishedAt,reviewedAt}}`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true); setNotice("");
    try {
      knowledgeBaseSchema.shape.mcpId.unwrap().parse(mcpId);
      const response = await fetch(`/api/knowledge-bases/${encodeURIComponent(base._id)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-knowledge-admin-code": code }, body: JSON.stringify({ mcpId, expectedMcpId: base.mcpId }), signal: AbortSignal.timeout(30_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.title || "Mapping verification failed.");
      onMapped(knowledgeBaseSchema.parse(data.knowledgeBase)); setCode(""); setNotice("MCP outline verified. Run an investigation to verify the indexed claim content.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mapping verification failed."); }
    finally { setPending(false); }
  }

  return <details className="tg-mapping"><summary><Link2 size={15} aria-hidden="true" />{base.mcpId ? "Change verified mapping" : "Connect Sanity Knowledge Base"}</summary><p>In Sanity Context, create a Knowledge Base, add this dataset query, and build entries. Retain exact claim IDs, statements, and source identifiers. Add the Knowledge Base to your Context MCP endpoint.</p><pre>{sourceQuery}</pre><div className="tg-mapping-links"><button type="button" className="tg-text-link" onClick={async () => { try { await navigator.clipboard.writeText(sourceQuery); setNotice("Dataset query copied."); } catch { setError("Clipboard access was unavailable."); } }}><Copy size={14} aria-hidden="true" />Copy dataset query</button><a href="https://www.sanity.io/docs/ai/sanity-context-create-knowledge-base" target="_blank" rel="noreferrer" className="tg-text-link">Sanity build guide<ArrowUpRight size={14} aria-hidden="true" /></a></div><form onSubmit={save}><label htmlFor={`mapping-${base._id}`}>Sanity Knowledge Base ID</label><input id={`mapping-${base._id}`} value={mcpId} onChange={(event) => setMcpId(event.target.value)} placeholder="kb..." required /><label htmlFor={`management-${base._id}`}>Knowledge-management code</label><input id={`management-${base._id}`} type="password" value={code} onChange={(event) => setCode(event.target.value)} required minLength={24} autoComplete="off" /><button className="tg-secondary" type="submit" disabled={pending}>{pending ? <LoaderCircle size={15} className="tg-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}Verify and save mapping</button></form>{error && <p className="tg-error" role="alert">{error}</p>}<p role="status" className="tg-notification">{notice}</p></details>;
}