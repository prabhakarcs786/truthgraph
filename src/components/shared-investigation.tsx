"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Link2 } from "lucide-react";
import { type Investigation } from "@/lib/knowledge";
import { investigationMarkdown } from "@/lib/investigation-export";
import { InvestigationResult } from "./investigation-result";

export function SharedInvestigation({ result, recordedAt }: { result: Investigation; recordedAt: string }) {
  const [notice, setNotice] = useState("");
  async function exportResult(copy: boolean) {
    try {
      const markdown = investigationMarkdown(result);
      if (copy) await navigator.clipboard.writeText(markdown);
      else {
        const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "truthgraph-investigation.md"; anchor.click(); URL.revokeObjectURL(url);
      }
      setNotice(copy ? "Investigation copied." : "Investigation downloaded.");
    } catch { setNotice("Export failed. The saved result remains available at this URL."); }
  }
  return <>
    <header className="tg-sidebar"><Link className="tg-brand" href="/" aria-label="TruthGraph home"><Image src="/icon" width={36} height={36} alt="" unoptimized /><span>truthgraph<small>SAVED INVESTIGATION</small></span></Link><Link className="tg-secondary" href="/"><ArrowLeft size={16} aria-hidden="true" />Workspace</Link></header>
    <main id="main" className="tg-main tg-shared">
      <div className="tg-page-heading"><div><span className="tg-eyebrow">SANITY SNAPSHOT / <time dateTime={recordedAt}>{recordedAt}</time></span><h1>{result.question}</h1></div></div>
      <p className="tg-notice"><Link2 size={16} aria-hidden="true" />Saved evidence as of {result.asOf}. This is a past result, not a new retrieval or a claim that the sources are still current.</p>
      <InvestigationResult result={result} stale={false} exportResult={(copy) => { void exportResult(copy); }} />
      <p role="status" aria-live="polite" className="tg-notification">{notice}</p>
    </main>
  </>;
}