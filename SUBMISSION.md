---
title: "TruthGraph: finding an answer is not the same as finding the applicable answer"
published: false
tags: devchallenge, sanitychallenge, sanity, ai
---

*This is a submission for the [Sanity Challenge, Path One: Ship an Agent That Queries Real Content](https://dev.to/challenges/sanity-2026-09-16).*

## What I Built

TruthGraph answers the question a search box can't: **which rule applies**. Sports rules change every season, and the right answer depends on the match date, the kind of match, and the competition. Ask "What happens if a goalkeeper holds the ball too long?" and a keyword search happily returns last season's rule. TruthGraph knows the 2025/26 Laws replaced it, applies the rule in force on your match date, and asks "which kind of match?" when the answer depends on it.

It ships three everyday collections built from official rulebooks: football (IFAB Laws of the Game), cricket (MCC Laws and ICC playing conditions), and chess (FIDE Laws of Chess).

Every answer sits next to what plain keyword search would have returned from the same Knowledge Base, and why that would be wrong.

## Demo

- Live application: https://truthgraph-mauve.vercel.app
- Source repository: https://github.com/prabhakarcs786/truthgraph
- Guided tour: open the app and choose **Start the guided tour**. No access code is needed.
- Custom questions: need a judge access code, which keeps the free model quota from being drained by the public. Judges can request it in a comment or DM and I will send it privately.

![The guided tour on the football collection, no access code needed](https://raw.githubusercontent.com/prabhakarcs786/truthgraph/main/docs/screenshots/1-home.png)

![Match date matters: keyword search returns the newest rule, TruthGraph applies the rule in force on 1 March 2025](https://raw.githubusercontent.com/prabhakarcs786/truthgraph/main/docs/screenshots/2-match-date.png)

![Depends on the match: TruthGraph asks which kind of match instead of guessing](https://raw.githubusercontent.com/prabhakarcs786/truthgraph/main/docs/screenshots/3-clarification.png)

### Three-minute walkthrough

| Tour card | TruthGraph | Plain keyword search |
| --- | --- | --- |
| Football, rule replaced: "What happens if a goalkeeper holds the ball too long?" | Corner kick after eight seconds, since 1 July 2025 | Same record this time; TruthGraph adds why it applies and which rule it replaced |
| Football, match date: same question for a match on 1 March 2025 | Indirect free kick after six seconds: the Law in force that day | The newest rule, which did not apply yet |
| Football, depends on the match: "How many substitutes can a team use?" | Asks: competition match, international friendly, or club friendly? | One number, for whichever match type matched best |
| Football, competition option: "Can a player get a red card for covering their mouth?" | Asks which competition: the IFAB made it a competition option, adopted for the World Cup 2026 | "Red card" for every match |
| Football, brand-new Law: advantage after a denied goal chance, goal scored. Booked? | No caution, from 1 July 2026 | Last season's rule: still booked |
| Cricket, same date, different level: bunny-hop boundary catch in club cricket on 1 March 2026 | Allowed in club cricket; already banned in internationals since June 2025 | One answer for both |
| Chess, older tournament: a switched-off phone in your pocket in 2012 | Allowed under the 2009 Laws (today it is forbidden) | Today's rule |

Beyond the tour, judges with the access code can ask everyday questions (offside, penalties, LBW, follow-on, castling, stalemate, running out of time) and see each answer cite the exact rule and official page. When sources genuinely disagree, TruthGraph shows the disagreement instead of picking a winner, and **Curate** (admin code) records which claim takes precedence as a structured relationship on the Sanity claim.

## Sanity Project

- Project ID: `d7k23z8r`
- Dataset: `production` (public)
- Knowledge Base: TruthGraph (`kb0JA1DdQw6D`), built from a dataset source filtered to claims, sources and collections (128 documents). Its 11 entries cite 90 of the 91 claims.

The corpus is 3 knowledge bases, 34 official sources and 91 claims (football 30, cricket 27, chess 34). With the recorded tour runs that is 143 of the 150 documents a Knowledge Base can index; the app shows the budget and refuses imports that would exceed it. Each sport mixes everyday basics (players, offside, penalties, overs, LBW, checkmate, castling) with rules that changed by date, level, or competition. Out-of-scope questions get "insufficient evidence" plus a list of what the collection covers, never a guess.

| Sanity type | What makes it structured |
| --- | --- |
| `tgSource` | Official URL, publisher, authority, publication and review dates |
| `tgClaim` | Subject, property, value, optional version range (semver), effective-from/until dates, named conditions (for example `match type=international friendly`, `level=club`, `time control=blitz`), and `supersedes`/`corrects` references with a reason |
| `tgKnowledgeBase` | Purpose, display order, Knowledge Base mapping, and the guided-tour scenarios |

## How I Used Sanity Context

The agent connects to a Knowledge Base-only Context MCP endpoint, reads `initial_context`, then chooses entries with `knowledge_base_read`. The server enforces which Knowledge Base it may use. The model returns intent and claim IDs, not factual prose. A claim counts as evidence only when a retrieved entry cites its ID. The answer quotes the canonical statement and source URL from Content Lake.

Deterministic code then applies dates, versions, conditions and explicit corrections, and detects remaining conflicts. Precedence decisions recorded in Curate are stored on the Sanity claim, so they take effect on the next question without rebuilding the Knowledge Base.

## Why Structured Content Matters

Every tour question is answered differently once structure is applied. The baseline panel ranks the same claims by keyword relevance and then explains which structural fact (date window, match type or other condition, replacement, correction, or conflict) makes its top hit wrong. Where keyword search happens to agree, the app says so.

## Data Sources (verified October 1, 2026)

- IFAB: Laws of the Game (Law 3, Law 12) and news of 1 March 2025, 28 February 2026, and 29 April 2026: https://www.theifab.com
- MCC: 2026 edition announcement (3 February 2026), 2022 code announcement, Timed Out statement (10 November 2023), and Law 19: https://www.lords.org and https://lawsofcricket.lords.org
- ICC: playing-condition changes of 20 September 2022 and 27 June 2025: https://www.icc-cricket.com
- ESPNcricinfo (secondary): the pre-2026 boundary-catch Law, 13 June 2025
- FIDE Handbook: Laws of Chess, 2009, 2014, 2018 and 2023 editions, and the 2023 publication notice: https://handbook.fide.com

Claims are original short summaries linked to these pages. FIDE applies each edition to competitions that start in its window; TruthGraph uses the question's date for that.

## Build and Verification

Built with GitHub Copilot in VS Code, Next.js 16, Sanity, the Vercel AI SDK with Gemini, Zod and semver.

- 136 unit tests: reasoning, grounding, baseline, curation, budgets, signed snapshots, and every tour question in all four collections.
- 30 Playwright tests on desktop and mobile with axe accessibility checks: tour, comparison, curation, sharing consent, uploads.
- A live run of all 14 sports tour questions against Sanity Context, each matching the expected claim or clarification. One run exposed the model filling in a competition the question never named; grounding now keeps a condition only when the question mentions it, as it already did for dates.

To stay within the free-tier model quota, each guided-tour answer is a recorded live run. It is reused only while the question, every canonical record, and the set of claims in effect today are unchanged, and the trace says when it was recorded. Custom questions always run live.

### Limitations

- The collections are small on purpose: 91 hand-verified claims, not whole rulebooks. Questions outside them get "insufficient evidence" and a list of what is covered.
- Custom questions use Gemini's free tier, so the model can occasionally miss a claim for an unusual phrasing (for example, an LBW question worded one way is answered, another way returns "insufficient evidence"). It never invents an answer instead.
- The hosted demo is read-only: Curate and new imports are disabled there and work in a local install with a Sanity write token.
- Uploaded documents stay in the browser for a private keyword preview; they are not added to the Sanity Knowledge Base.

Deployed on Vercel; last verified end to end on 2 October 2026.