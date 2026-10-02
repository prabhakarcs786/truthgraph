# TruthGraph Implementation Notes

Date: October 1, 2026. Scope: Path One only. Path Two application files were not changed.

## Verified Sanity Capabilities

Official docs were consulted before changing the live integration:

- Context MCP is a hosted, read-only service; it does not run the application agent loop.
- Knowledge Base mode exposes `initial_context` and `knowledge_base_read`. Reads take a platform Knowledge Base ID and up to 20 exact entry paths.
- Authentication uses an organization Context Viewer token, not a project token.
- A Context endpoint's mode derives from its sources. A dataset source takes precedence over Knowledge Base sources; request parameters can explicitly select Knowledge Base mode and IDs.
- Knowledge Bases are built ahead of queries. Entries may be rewritten on rebuild; edits belong in source content or instructions, not generated entries.
- Build-time issues and persisted resolution instructions are managed in Sanity. No unsupported write endpoint was invented in this app.

References: https://www.sanity.io/docs/ai/sanity-context-mcp, https://www.sanity.io/docs/ai/sanity-context-mcp-tools, https://www.sanity.io/docs/ai/sanity-context-knowledge-bases.

## Product Correction

The previous implementation was an upgrade checker with five coded topics and a required Next.js profile. That was one possible domain, not the user's intended reusable evidence agent. The replacement removes those controls, types, fixed decision branches, endpoint, and tests. The directory/archive name remains stable for compatibility; the product is now TruthGraph.

The user was unavailable to pick a new domain. No replacement domain was assumed: the previously reviewed official documentation remains an optional real-source sample. The separately labelled Atlas lab is invented regression material, not competition evidence. Only the real sample is seeded/exported by default.

## Architecture and Schema

Three types replace the larger proposed taxonomy: `tgKnowledgeBase`, `tgSource`, and `tgClaim`. A source represents the attributable publication; a separate knowledgeDocument type was not necessary for this first version. Conditions and directed relationships live on claims. There is no duplicated supersededBy list, separate correction document, or dedicated compatibility-rule class.

The shared reasoning module accepts a question intent, retrieved claim IDs, and canonical corpus. Dates, semver ranges, named equality conditions, replacement links, duplicate IDs, and exclusive-value conflicts are handled deterministically. Model work is limited to intent extraction and navigating MCP evidence. The answer is composed of grounded canonical claim sentences, not a second unvalidated model completion.

Files are grouped by responsibility:

- `knowledge.ts`: content/request/response contracts and the canonical catalog query.
- `reasoning.ts`: applicability, supersession, conflict, and evidence-strength decisions.
- `grounding.ts`: proof that selected IDs/statements/source identifiers occurred in the selected MCP corpus.
- `investigator.ts`: bounded live MCP/model loop and application trace.
- `sample-investigation.ts`: explicitly local, limited token matching for the no-account sample.
- `sample-data.ts`: real sample and isolated synthetic fixtures.
- `investigation-workspace.tsx` and `investigation-result.tsx`: question-first UI and evidence inspection.
- `knowledge-import.ts` and `import-storage.ts`: bounded text/JSON preparation, provenance validation, exports, and local persistence.
- `import-management.ts`: separately authenticated Content Lake imports and verified, revision-guarded MCP mappings.
- `upload-investigation.ts`: consent-gated direct model evidence selection for private uploads, with a distinct response mode and no Sanity side effects.
- `knowledge-source-shelf.tsx`: source-content previews and direct evidence inspection beside the question workspace.

## Dynamic Imports

The collection is no longer limited to bundled samples or Studio-only authoring. The app accepts UTF-8 text, Markdown, and structured JSON through an upload/review flow. Text becomes literal excerpts with a decoded-text SHA-256 identifier and retained original content. No publication/effective dates, authority, versions, or correction relationships are inferred. Authored JSON preserves those fields and directed links, while rekeying IDs and discarding unverified MCP mappings.

Local imports persist in origin-specific browser storage in both app modes. Private-preview questions run in the browser; neither the uploaded corpus nor those questions are sent to the server/model. An optional first question can run immediately after review. JSON backups, indexing Markdown, cross-tab refresh, and confirmed local removal are available. Storage is not encrypted; browser quotas and clearing remain user-controlled. Text is rendered as text, and content URNs are not navigable web links.

In live mode, a management code separate from the judge code authorizes atomic `create` transactions using a project write token. Existing IDs are never replaced. The returned state is `awaiting-index`, not ready. A human creates/builds the Sanity Knowledge Base using the supplied query or indexing export. Mapping verification checks the scoped MCP outline and saves only against the captured Sanity revision. The normal investigation still validates actual indexed statements and provenance. Original texts remain in source documents; the app does not offer cloud deletion or claim automatic KB build/synchronization.

Limits are explicit: 8 raw files/256 KB, one JSON bundle/1 MB, 20 sources and 100 claims per import, 1 MB HTTP import bodies, and per-process management budgets. A larger JSON allowance permits a valid exported bundle containing both source text and claims to be restored. Synthetic imports cannot be saved to a shared Sanity collection. Management credentials are never persisted in browser storage or included in exports.

## Polished Immediate Workflow

The October 1 UI refinement follows Afterlight's visual hierarchy without copying its museum experience: self-hosted DM Serif Display headings, DM Sans controls, a horizontal header, restrained green/coral/olive source previews, and a document-first starting screen. The source shelf displays actual supplied statements, not decorative stock media. Source inspection filters the evidence library. The three result modes remain visibly distinct.

Direct-upload AI is an explicit hybrid addition, not an automated Sanity indexing claim. In live app mode a visitor can retain a personal browser collection, opt into model processing, and supply the judge code without obtaining write permission. The server validates the entire prepared bundle and file fingerprints, sends only the supplied claim catalog and question to a tool-free model call, validates its selected IDs, and composes factual answers from the original statements. User-provided authority is not independently verified. Unknown/duplicate IDs and provider errors fail rather than becoming demo answers. Effective-date and conflict rules remain authored metadata, not model-invented deductions.

The direct-upload endpoint has a 1 MB body limit, 30-second deadline, zero retries, 2500 output tokens, and a separate process-local 10-request/minute budget. No shared content is written. Explicit consent is reset when selecting another corpus and is not persisted. This is suitable for an authenticated bounded demonstration after real credentials are verified; it does not establish unrestricted anonymous-service readiness.

Rendered tests exercise immediate paste-to-answer, source inspection, 320px reflow, and desktop/mobile typography. A separate production-mode browser suite intercepts model responses to verify consent, access controls, provenance labels, failure behavior, and return to private preview. These tests deliberately do not prove a real provider call.

## Semantics and Risks

- Version subjects are explicit, so one product's version is not compared with another's. Partial ranges that only overlap a rule request clarification rather than assuming a patch.
- Effective-until is exclusive. Publication, review, and effective dates are distinct. Explicit dated questions without effective metadata cannot get a definitive historical answer.
- Different values conflict only when claims are marked exclusive and share an applicable subject/predicate. Authors must normalize these concepts correctly; arbitrary prose strings do not automatically establish contradiction.
- Newer and higher-authority sources do not automatically win. Authority only affects presentation/evidence strength after applicability and explicit precedence are checked.
- Alternatives for the same fact and replacement targets must be retrieved. The canonical catalog can identify a missing peer, but its unretrieved statement is not used to answer.
- Cycles and cross-corpus references cannot silently establish precedence. Supports/related links provide retrieval context but do not increase confidence automatically.
- Current statement text must be retained in the KB entry. Sanity may rewrite prose, so actual indexing behavior must be verified with real credentials. Failing grounding is an explicit error; the app does not relax it or substitute samples.
- A shared project can expose multiple configured knowledge bases. Corpus descriptions/suggestions are public UI metadata; claim/source inspection is protected in live mode. This is not a general multi-tenant authorization system.
- No local vector database, fake MCP transport, fabricated source, or synthetic conflict is represented as live Sanity functionality.

## Verification and Remaining Work

The new model, retrieval guard, HTTP contract, and UI were developed in focused increments with immediate tests. Desktop/mobile browser runs verify question-dependent results, version changes, temporal corrections, unresolved conflict, missing patch context, insufficient evidence, structured inspection, exports, and automated accessibility. Local tests use fakes for cloud boundaries; they cannot establish live Sanity or provider behavior.

The live acceptance command now uses a question from the selected corpus, not predefined upgrade scenarios. Before submission, choose the final real source collection, verify its metadata and source rights, build/map its Sanity KB, run the actual live acceptance and browser flows, and replace submission placeholders with real evidence. Synthetic fixtures can explain a test technique but must not substitute for that demonstration.

Local verification also covers upload/review, unrelated uploaded questions, absence of remote upload/investigation requests, reload persistence, JSON round trips, duplicate/invalid/oversized file rejection, file provenance, export, and keyboard removal on desktop/mobile. Management tests exercise actual HTTP handlers with mocked Sanity/MCP boundaries. Run the commands in README.md to reproduce; no actual Sanity account, Knowledge Base build, or paid provider call was exercised.