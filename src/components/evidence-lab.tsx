"use client";

import { useId, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, ChevronRight, CircleAlert, FlaskConical, RotateCcw } from "lucide-react";
import { minVersion } from "semver";
import { compareEvidenceScenario, evidenceScenarioSchema, scenarioReport, type ScenarioState } from "@/lib/evidence-lab";
import { type EvidenceState, type Investigation } from "@/lib/knowledge";

export const evidenceStateLabels: Record<EvidenceState, string> = { applicable: "Applicable", superseded: "Superseded", "out-of-scope": "Different scope", "not-yet-effective": "Not yet effective", expired: "Expired", "needs-context": "Context needed", unresolved: "Unresolved" };
const stateLabel = (state: ScenarioState) => state === "excluded" ? "Source excluded" : evidenceStateLabels[state];

export function EvidenceLab({ result, stale }: { result: Investigation; stale: boolean }) {
  const prefix = useId();
  const versionSubjects = [...new Set(result.evidence.flatMap((item) => item.claim.version ? [item.claim.version.subject] : []))];
  const sources = [...new Map(result.evidence.map((item) => [item.source._id, item.source])).values()];
  const initialSubject = result.intent.version?.subject || versionSubjects[0] || "";
  const [versionSubject, setVersionSubject] = useState(initialSubject);
  const [version, setVersion] = useState(result.intent.version?.value || "");
  const [date, setDate] = useState("");
  const [conditions, setConditions] = useState(result.intent.conditions);
  const [excludedSourceIds, setExcludedSourceIds] = useState<string[]>([]);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [notice, setNotice] = useState("");
  const versionOptions = [...new Set(result.evidence.flatMap((item) => item.claim.version?.subject === versionSubject ? [minVersion(item.claim.version.range)?.version || item.claim.version.range] : []))];
  const conditionKeys = [...new Map([...result.intent.conditions, ...result.evidence.flatMap((item) => item.claim.conditions)].map((condition) => [condition.key.toLowerCase(), condition.key])).values()];
  const parsed = evidenceScenarioSchema.safeParse({
    version: versionSubject && version.trim() ? { subject: versionSubject, value: version.trim() } : null,
    asOf: date || null,
    conditions: conditions.map((condition) => ({ ...condition, value: condition.value.trim() })).filter((condition) => condition.value),
    excludedSourceIds,
  });
  const comparison = parsed.success ? compareEvidenceScenario(result, parsed.data) : null;
  const versionInvalid = !parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "version");
  const dateInvalid = !parsed.success && parsed.error.issues.some((issue) => issue.path[0] === "asOf");
  const rows = comparison?.rows.filter((row) => !onlyChanges || row.changed) || [];

  function reset() {
    setVersionSubject(initialSubject); setVersion(result.intent.version?.value || ""); setDate("");
    setConditions(result.intent.conditions); setExcludedSourceIds([]); setOnlyChanges(false); setNotice("Scenario reset.");
  }

  function download() {
    if (!parsed.success || stale) return;
    try {
      const url = URL.createObjectURL(new Blob([scenarioReport(result, parsed.data)], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "truthgraph-evidence-comparison.json";
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setNotice("Comparison downloaded.");
    } catch { setNotice("The comparison could not be downloaded."); }
  }

  return <details className="tg-evidence-lab">
    <summary aria-label="Evidence Lab">
      <FlaskConical size={19} aria-hidden="true" />
      <span><strong>Evidence Lab</strong><small>Hypothetical comparison</small></span>
      <ChevronRight size={17} className="tg-expand" aria-hidden="true" />
    </summary>
    <div className="tg-lab-toolbar">
      <div><h2>What changes the evidence?</h2><p className="tg-lab-boundary">Retrieved snapshot only / no new search</p></div>
      <div className="tg-tools">
        <button type="button" className="tg-icon" title="Reset scenario" aria-label="Reset scenario" disabled={stale} onClick={reset}><RotateCcw size={17} aria-hidden="true" /></button>
        <button type="button" className="tg-icon" title="Download comparison" aria-label="Download comparison" disabled={stale || !parsed.success} onClick={download}><ArrowDownToLine size={18} aria-hidden="true" /></button>
      </div>
    </div>
    <div className="tg-lab-controls">
      <fieldset className="tg-lab-context" disabled={stale}>
        <legend>Scenario context</legend>
        {versionSubjects.length > 0 && <>
          <label className="tg-lab-field">Versioned subject<select value={versionSubject} onChange={(event) => { setVersionSubject(event.target.value); setVersion(""); setNotice(""); }}>{versionSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
          <label className="tg-lab-field">Scenario version<input value={version} onChange={(event) => { setVersion(event.target.value); setNotice(""); }} list={`${prefix}-versions`} placeholder="Unspecified" maxLength={120} aria-invalid={versionInvalid} aria-describedby={versionInvalid ? `${prefix}-error` : undefined} /><datalist id={`${prefix}-versions`}>{versionOptions.map((option) => <option key={option} value={option} />)}</datalist></label>
        </>}
        <div className="tg-lab-field tg-lab-wide"><label htmlFor={`${prefix}-date`}>Scenario date</label><input id={`${prefix}-date`} type="date" value={date} onChange={(event) => { setDate(event.target.value); setNotice(""); }} aria-invalid={dateInvalid} aria-describedby={`${prefix}-date-note${dateInvalid ? ` ${prefix}-error` : ""}`} /><small id={`${prefix}-date-note`}>Reference date: {result.asOf}. No explicit date unless set.</small></div>
        {conditionKeys.map((key, index) => {
          const values = [...new Set([...result.intent.conditions, ...result.evidence.flatMap((item) => item.claim.conditions)].filter((condition) => condition.key.toLowerCase() === key.toLowerCase()).map((condition) => condition.value))];
          return <label className="tg-lab-field tg-lab-wide" key={key}>Scenario {key}<input value={conditions.find((condition) => condition.key.toLowerCase() === key.toLowerCase())?.value || ""} maxLength={120} placeholder="Unspecified" list={`${prefix}-condition-${index}`} onChange={(event) => { const value = event.target.value; setConditions((previous) => [...previous.filter((condition) => condition.key.toLowerCase() !== key.toLowerCase()), ...(value ? [{ key, value }] : [])]); setNotice(""); }} /><datalist id={`${prefix}-condition-${index}`}>{values.map((value) => <option key={value} value={value} />)}</datalist></label>;
        })}
      </fieldset>
      <fieldset className="tg-lab-source-options" disabled={stale}>
        <legend>Included sources</legend>
        {sources.map((source) => <label className="tg-lab-source" key={source._id}>
          <input type="checkbox" aria-label={`Include ${source.title}`} checked={!excludedSourceIds.includes(source._id)} onChange={(event) => { setExcludedSourceIds((previous) => event.target.checked ? previous.filter((id) => id !== source._id) : [...previous, source._id]); setNotice(""); }} />
          <span><strong>{source.title}</strong><small>{source.publisher} / {source.authority}</small></span>
          <span className="tg-mono">{result.evidence.filter((item) => item.source._id === source._id).length}</span>
        </label>)}
      </fieldset>
    </div>
    {!parsed.success && <p className="tg-error" id={`${prefix}-error`} role="alert"><CircleAlert size={17} aria-hidden="true" />{versionInvalid ? "Invalid semantic version or range." : dateInvalid ? "Invalid scenario date." : "Each condition needs one valid value."}</p>}
    {comparison && <>
      <div className="tg-lab-summary" role="status" aria-live="polite" aria-atomic="true"><span><strong>{comparison.changedCount}</strong> claim statuses changed</span><span><strong>{comparison.applicableCount}</strong> applicable in scenario</span><span><strong>{comparison.conflicts.filter((conflict) => !conflict.resolved).length}</strong> unresolved disagreements</span></div>
      {excludedSourceIds.length > 0 && <p className="tg-lab-warning"><CircleAlert size={16} aria-hidden="true" />Source exclusion is hypothetical. Original disagreements remain on record.</p>}
      <label className="tg-lab-filter"><input type="checkbox" checked={onlyChanges} onChange={(event) => setOnlyChanges(event.target.checked)} />Only changed claims</label>
      {comparison.excludedCount === result.evidence.length && <p className="tg-lab-empty">No included claims in this scenario.</p>}
      <ol className="tg-lab-rows">{rows.map((row) => <li className="tg-lab-row" key={row.original.claim._id} data-claim-id={row.original.claim._id} data-changed={row.changed}>
        <div className="tg-lab-claim"><h3>{row.original.claim.subject} / {row.original.claim.predicate}</h3><p>{row.original.claim.statement}</p><a className="tg-text-link" href={`#${row.original.claim._id}`}>{row.original.source.title}<ArrowUpRight size={13} aria-hidden="true" /></a></div>
        <div className="tg-lab-transition"><div><span>Original</span><strong className="tg-lab-state" data-state={row.original.state}>{stateLabel(row.original.state)}</strong></div><ArrowRight size={16} aria-hidden="true" /><div><span>Hypothetical</span><strong className="tg-lab-state" data-scenario-state={row.state}>{stateLabel(row.state)}</strong></div></div>
        <ul className="tg-lab-reasons">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </li>)}</ol>
      {onlyChanges && !rows.length && <p className="tg-lab-empty">No claim-status changes in this snapshot.</p>}
      {comparison.pending.length > 0 && <div className="tg-lab-pending"><h3>Scenario uncertainties</h3><ul>{comparison.pending.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {result.followUp.length > 0 && <details className="tg-lab-gaps"><summary>Original evidence gaps ({result.followUp.length})</summary><ul>{result.followUp.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    </>}
    <p className="tg-lab-footnote">Original answer unchanged. Other evidence may exist outside this snapshot.</p>
    <p className="tg-lab-notice" role="status">{notice}</p>
  </details>;
}