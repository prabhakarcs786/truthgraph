"use client";

import { CheckCircle2, CircleAlert, Scale } from "lucide-react";
import { type Investigation } from "@/lib/knowledge";

const verdictLabels = { agrees: "Same record", outdated: "Outdated record", "wrong-scope": "Wrong version or condition", "wrong-date": "Not in effect on this date", "missing-context": "Answers too early", "hides-conflict": "Hides a disagreement", unrelated: "Off-topic record", "no-match": "No match" } as const;
const statusLabels = { answered: "Supported answer", conflict: "Sources disagree", "needs-context": "Asks for context", insufficient: "Insufficient evidence" };

export function BaselineComparison({ result }: { result: Investigation }) {
  const baseline = result.baseline;
  if (!baseline) return null;
  const agrees = baseline.verdict === "agrees" || (baseline.verdict === "no-match" && result.status === "insufficient");
  const answer = result.status === "answered" ? result.statements[0]?.text : result.status === "needs-context" ? result.followUp[0] ?? result.answer : result.answer;
  return <section className={`tg-compare ${agrees ? "agrees" : "differs"}`} aria-labelledby="compare-heading">
    <div className="tg-section-line"><h2 id="compare-heading"><Scale size={19} aria-hidden="true" />Keyword search vs TruthGraph</h2><span className="tg-mono">Same knowledge base / same question</span></div>
    <div className="tg-compare-grid">
      <article className="tg-compare-card baseline">
        <span className="tg-eyebrow">PLAIN KEYWORD SEARCH / TOP HIT</span>
        {baseline.statement ? <blockquote>{baseline.statement}{baseline.sourceTitle && <small>{baseline.sourceTitle}</small>}</blockquote> : <p className="tg-compare-empty">No stored statement matched the question&apos;s words.</p>}
        <p className={`tg-compare-verdict ${agrees ? "ok" : "warn"}`}>{agrees ? <CheckCircle2 size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}<strong>{verdictLabels[baseline.verdict]}</strong></p>
        <p className="tg-compare-why">{baseline.explanation}</p>
      </article>
      <article className="tg-compare-card truthgraph">
        <span className="tg-eyebrow">TRUTHGRAPH / STRUCTURED EVIDENCE</span>
        <blockquote>{answer}</blockquote>
        <p className="tg-compare-verdict ok"><CheckCircle2 size={15} aria-hidden="true" /><strong>{statusLabels[result.status]}</strong></p>
        <p className="tg-compare-why">{result.reasoningSummary} Checked as of {result.asOf} against version ranges, conditions, effective dates, and recorded corrections.</p>
      </article>
    </div>
  </section>;
}
