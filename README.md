# Narrately

An AI CLI tool that automatically generates your daily developer activity report from your IDEs, terminal, and Git history.

Originally scoped as the **MVP** described in `docs/narrately_ai_product_document.pdf` (VS Code + JetBrains IntelliJ-platform IDEs). This is **v1.1**, which per the product roadmap adds two things on top of that MVP: deeper IDE enrichers (edit volume, debug sessions, idle detection, diagnostics, branch context) and expanded cross-project/cross-day graph queries — "what have I worked on this week across all projects."

The differentiator is not data capture (that problem is commoditised) but **synthesis**: turning raw telemetry into a written daily log you can paste straight into a standup or timesheet.

---

## Quick start

```bash
npm install
npm link          # puts `narrately` on your PATH
narrately onboard    # 7-step setup wizard
narrately daemon start
narrately report
```

Set `ANTHROPIC_API_KEY` (Claude, the default) or `GEMINI_API_KEY` (Gemini) to get the written narrative. Without a key, reports still generate — just structured rather than narrated.

---

## Architecture

Five layers with a single responsibility each, joined by one shared event schema:

```
 VS Code Extension ─┐
                    ├──► Local Collector Daemon ──► SQLite (raw_events)
 IntelliJ Plugin ───┘                │
                                     ├──► Shell hook (timestamped commands)
                                     └──► Git log scraper (commits, branches)
                                                    │
                                                    ▼
                                   Aggregator (raw events → sessions)
                                                    │
                                                    ▼
                                Knowledge Graph layer (nodes / edges)
                                                    │
                                                    ▼
                       LLM Report Generator (Claude / Gemini — pluggable)
                                                    │
                                     ┌──────────────┴──────────────┐
                                     ▼                             ▼
                              CLI / Markdown                 Email delivery
```

Both IDE integrations are **thin producers**. They emit the same JSON event shape and hold no knowledge of SQLite, the graph, or report generation. That decoupling is what keeps the pipeline IDE-agnostic: adding a third editor means writing one more adapter, not touching anything downstream.

### Shared event schema

```json
{
  "timestamp": "2026-07-28T09:14:32Z",
  "source": "vscode | intellij",
  "project": "auth-service",
  "file": "src/auth.py",
  "language": "python",
  "branch": "main",
  "event": "editor_focus_start | editor_focus_end | save | edit | debug_start | debug_end | idle | diagnostics | file_create | file_delete | file_rename",
  "metrics": { "linesAdded": 12, "linesRemoved": 3, "charsChanged": 240 }
}
```

`focus_start` / `focus_end` pairing into a duration happens **in the daemon**, not in the plugins — so neither plugin does timing arithmetic. `debug_start` / `debug_end` pair the same way, on a separate tracker, so a debug session spanning several files isn't torn apart by focus changes. `metrics` and `branch` are new in v1.1 — `metrics` is always a flat object of integer counts (never file content), and the daemon strips any key it doesn't recognize before it ever reaches storage.

---

## v1.1 — deeper enrichers and expanded queries

### IDE enrichers

Both collectors now report, beyond focus and save:

- **Edit volume** — lines added/removed and characters changed, accumulated in memory and flushed as one aggregated burst (not per-keystroke). Only integer counts cross the process boundary; the changed text itself is measured for size and never transmitted.
- **Debug sessions** — a `debug_start`/`debug_end` span per debugger run, so "40m debugging" reads differently from "40m editing" in the narrative.
- **Idle detection (AFK truncation)** — after 5 minutes (configurable) with no keystrokes or selection changes, the focus period is closed *backdated to the last real activity*, and an `idle` event records the gap. Counting lunch as coding time is the fastest way to make the whole report untrustworthy, so idle time is recorded but never subtracted from — or added to — tracked duration; it just isn't there in the first place.
- **File create / delete / rename** — structural changes to the project, surfaced in the narrative as "Structural changes: create new.py; delete old.py".
- **Diagnostics deltas** — how many editor-reported errors got resolved, not the absolute count (so "resolved 3 errors" is a real narrative claim, not a snapshot).
- **Git branch** — read directly from `.git/HEAD` (no dependency on an optional VCS extension being enabled), attached to every event so a report can say "worked across `main` and `feature/oauth`".

### Expanded graph queries

```bash
narrately graph week                   # cross-project rollup for the current week (the flagship v1.1 query)
narrately graph timeline               # day-by-day breakdown over a window
narrately graph files --project foo    # most-touched files, optionally scoped
narrately graph related auth-service   # other projects sharing a technology (multi-hop)
narrately graph search "token"         # free-text across projects/files/commits/commands
narrately graph compare --week         # this window vs. the immediately preceding one
narrately graph focus                  # how fragmented vs. focused each day was
```

### Weekly reports and natural-language questions

```bash
narrately report --week                                              # a written weekly rollup, not just a daily one
narrately ask "what have I worked on this week across all projects"   # the PRD's example question, answered directly
narrately ask "how much time went into billing-api this month"
```

`ask` infers its time window from the question ("today", "this week", "last month") or from `--since`/`--days`, assembles the same graph-query aggregates a report would use, and asks the configured LLM to answer grounded strictly in that data — same `--provider`/`--model` overrides as `narrately report`. Same privacy boundary as reports: the model sees durations, counts, and file/project labels — never raw events or file contents. Without an API key it prints the underlying data instead of a written answer.

### Chat — multi-turn, on your notes too

```bash
narrately chat                    # terminal chat — type a question, get an answer, keep going
narrately chat --provider gemini  # same --provider/--model overrides as ask/report
narrately web                     # or use the Chat panel in the dashboard
```

`narrately chat` is `ask` extended into a real conversation: it keeps the last several turns as history so follow-ups resolve naturally ("what about last week", "and the other project"), and — this is the point of it — the grounding data includes your [notes](#web-dashboard), not just activity aggregates. Ask "what did I decide about the auth migration" and it answers from what you actually wrote, not from file-touch counts. The same `/api/chat` endpoint backs the dashboard's Chat panel, so both surfaces are grounded identically; only the interface differs. Conversation history lives in memory for that session only (terminal process or browser tab) — it's never written to disk.

### Why repeated queries don't inflate your history

Sessions are rebuilt from `raw_events` on every aggregation pass, and — especially now that `graph`/`ask`/`report --week` are meant to be run repeatedly through the day — that pass will legitimately re-cover a window it already aggregated once. Two things make this safe:

- Session IDs are **deterministic** (derived from project + start time), not random, so re-persisting the same underlying activity updates the same row instead of inserting a duplicate.
- Folding a session into the knowledge graph is now **idempotent** — a `graph_synced` flag tracks which sessions have already contributed their edges, so re-running `narrately report --week` three times in a day still reports one hour of work as one hour, not three.

See `test/idempotent-aggregation.test.js` for the regression coverage.

---

## LLM providers

The narrative step is pluggable — `narrately report` and `narrately ask` both go through a small provider registry (`src/pipeline/providers/`) instead of calling Claude directly. Two providers ship today:

| Provider           | id         | Env var(s)                                    | Default model      |
| ------------------ | ---------- | --------------------------------------------- | ------------------ |
| Claude (Anthropic) | `claude` | `ANTHROPIC_API_KEY` (or `ant auth login`) | `claude-opus-5`  |
| Gemini (Google)    | `gemini` | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)    | `gemini-2.5-pro` |

**Choosing a provider:**

- `narrately onboard` step 7 asks which LLM should write the narrative and saves it to `config.yaml` as `report.provider` (plus `report.model`, if you're pinning a specific model).
- `--provider <id>` and `--model <id>` on `narrately report` and `narrately ask` override the configured default for a single run — they're never persisted:
  ```bash
  narrately report --provider gemini
  narrately ask "what did I work on this week" --provider gemini --model gemini-2.5-flash
  ```
- `narrately status` shows which provider is active and whether it has a usable API key.

Gemini authenticates via the `x-goog-api-key` request header, never a URL query parameter, so the key never ends up in logs or proxy history. Adding a third provider means implementing the same six-export contract (`id`, `label`, `defaultModel`, `hasApiKey()`, `generateNarrative()`, `answerQuestion()`) in one new file and registering it in `providers/index.js` — no other code changes.

---

## Commands

| Command                                        | What it does                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `narrately onboard`                          | Interactive setup: work profile, IDE detection, plugin install, shell integration, project roots + diff-capture defaults, privacy exclusions + retention, report preferences + model pin, and an optional advanced step (daemon port, focus threshold, git collector) |
| `narrately install <vscode\|intellij\|shell>`  | Install one collector                                                                                                                                                                                                                                                 |
| `narrately daemon start\|stop\|status\|restart` | Control the background collector                                                                                                                                                                                                                                      |
| `narrately report`                           | Generate a report from accumulated events                                                                                                                                                                                                                             |
| `narrately schedule enable\|disable\|status`   | Manage the OS-level daily schedule                                                                                                                                                                                                                                    |
| `narrately status`                           | Collector, data, and configuration health                                                                                                                                                                                                                             |
| `narrately config list\|get\|set\|path`         | View or edit any setting without hand-editing`config.yaml` — see below                                                                                                                                                                                             |
| `narrately graph <query>`                    | Query the local knowledge graph — see below                                                                                                                                                                                                                          |
| `narrately ask "<question>"`                 | Ask a one-off natural-language question grounded in your recorded activity                                                                                                                                                                                            |
| `narrately chat`                             | Interactive chat — multi-turn, grounded in your activity and your notes                                                                                                                                                                                              |
| `narrately ingest`                           | Force a shell + git collection pass                                                                                                                                                                                                                                   |
| `narrately web`                              | Open the local detail dashboard — projects, files, notes, report history, chat                                                                                                                                                                                       |

### Report options

```bash
narrately report                      # since the last report (or last 24h on first run)
narrately report --day 2026-07-28     # a specific day
narrately report --week               # the current week, cross-project
narrately report --since "3 days ago" # an explicit window
narrately report --json               # machine-readable (nothing else touches stdout)
narrately report --email              # force email delivery
narrately report --no-collect         # skip the pre-report collection pass
narrately report --provider gemini    # one-off LLM override (see LLM providers)
narrately report --model gemini-2.5-flash
```

### Graph queries

```bash
narrately graph projects --week        # time per project this week
narrately graph tech --month           # technologies used this month
narrately graph week                   # the flagship cross-project weekly rollup
narrately graph timeline               # daily breakdown
narrately graph files [--project x]    # most-touched files
narrately graph files --churn          # same, ranked by lines added/removed instead of touch count
narrately graph related <project>      # projects sharing a technology
narrately graph search <term>          # free-text search
narrately graph compare                # this window vs. the previous one
narrately graph focus                  # fragmented vs. focused days
narrately graph project <name>         # what connects to this project
narrately graph stats
```

Every query accepts a window: `--week | --month | --days <n> | --since <date>`.

### Configuration

`narrately onboard` covers the settings most people need. Everything else in `config.yaml` —
including a few fields the wizard deliberately doesn't ask about up front, like the daemon
port — is reachable the same way, without opening the file by hand:

```bash
narrately config list                              # the whole config, SMTP password redacted
narrately config get daemon.port                    # a single value, dot-path addressed
narrately config get email.smtp.pass --reveal       # secrets are hidden unless you ask
narrately config set daemon.port 47822              # numbers, booleans, and null are coerced
narrately config set privacy.excluded_paths "node_modules, .env"   # comma-separated, same as onboarding
narrately config path                               # print config.yaml's location
```

`report.mode`, `report.verbosity`, and `report.provider` are validated against their known
values on `set`; everything else accepts whatever you give it, same as hand-editing the YAML.

---

## Web dashboard

```bash
narrately web                # starts the dashboard and opens it in your browser
narrately web --port 47831   # pick a different port
narrately web --no-open      # print the URL instead of launching a browser
```

A local, read/write view over the same data the CLI queries — time by project, the daily timeline, top files by edit churn, focus analysis, a chat panel, and your notes, switchable between Today / This week / 30 days / All time. It's built as a single static HTML file with vanilla JS (no build step, no CDN dependency — works fully offline) served by a small HTTP server (`src/web/server.js`) that mirrors the collector daemon's own trust model: **bound to `127.0.0.1` only**, unauthenticated by design, never reachable off the machine.

Two things live only in the dashboard, not the CLI:

- **Notes** — free text you type on purpose, scoped to a day and optionally a project. This is deliberately the one place Narrately stores detail beyond counts and file paths — context the automated collectors never capture by design (why you spent the afternoon on that one bug, a decision made in a meeting). Notes are local-only, stored in their own `notes` table, and only ever reach an LLM if you ask [Chat](#chat--multi-turn-on-your-notes-too) a question that pulls them into its grounding data — never automatically.
- **Report history** — browse and re-read any previously generated report (`narrately report` output) without hunting through `~/.narrately/reports/`.

### Per-file edit churn

The v1.1 enrichers already captured line-level edit counts per file (see `metrics` on the `edit` event), but earlier releases collapsed that down to a per-project total before it reached a report. As of this release, `linesAdded`/`linesRemoved`/`edits` are preserved per file through the whole pipeline — sessions, project summaries, the LLM prompt, the fallback report's new **Top files by churn** section, `narrately graph files --churn`, and the dashboard's file table. Still counts only: the changed text itself is measured for size in the IDE and never crosses the process boundary, same as every other enricher.

---

## Code change capture

Everything above this line — edit counts, file paths, churn — tells you *that* something changed and *how much*. It never tells you *what*. Code change capture is the deliberate, opt-in exception: it stores the actual diff text for your own work, in two independent tiers.

**Off by default, everywhere, both tiers.** Enable per project in `narrately onboard` (step 5 asks per repository — Tier 2 only if you said yes to Tier 1), or by hand in `config.yaml`:

```yaml
collectors:
  git:
    capture_diffs: false          # Tier 1 collector-level default
project_roots:
  - path: C:/code/auth-service
    label: auth-service
    capture_diffs: true           # Tier 1 per-project override — takes precedence
    capture_save_diffs: true      # Tier 2 — independent flag, higher exposure (see below)
```

```bash
narrately graph diffs                  # list captured diffs for the current window (both tiers)
narrately graph diffs --project x      # scoped to one project
narrately graph diffs --full           # print the actual diff text, not just the summary line
```

`narrately status` always shows which projects have either tier on (`[capturing code changes]`, `[capturing uncommitted changes]`), and a diff count under **Data** — this is never a silent background state.

### Tier 1 — your own commits

When a project has `capture_diffs` on, the git collector runs `git show` for each *new* commit it discovers (nothing retroactive — a commit already scraped without diff capture stays diff-less even if you turn the setting on later), splits the output per file, and for each file:

1. Applies the same path/repo/pattern exclusions (`privacy.excluded_*`) as everything else — an excluded file's diff is never captured, even with `capture_diffs` on.
2. Redacts secret-shaped strings (`src/core/redact.js`) — AWS/Google/GitHub/Slack key formats, JWTs, PEM private key blocks, and `keyword = "value"` / `KEY=value` assignments — before anything touches disk. This is a safety net, not a guarantee; the primary control is the opt-in default-off setting, not the regex list.
3. Drops (not truncates) any single file's diff over 50KB — the row still exists with its line counts, but `diff_text` is `null` and a note explains why. A partial diff that reads as complete is worse than one that's clearly missing.

Only your own commits are ever affected — this only runs where `capture_diffs` is explicitly on, and only against a repo you already configured as a project root.

### Tier 2 — uncommitted, in-progress work

Higher exposure than Tier 1 by design — it captures a diff on every save, before you've reviewed or committed anything — which is why it's a second, independent opt-in (`capture_save_diffs`), not a consequence of turning Tier 1 on.

Architecture, deliberately kept server-authoritative:

1. The VS Code extension periodically asks the daemon (`GET /capture-config`) which project roots have `capture_save_diffs` on. It never calls `document.getText()` — never even reads a file's content — for any project that hasn't confirmed this, and the extension itself carries no local override for this decision.
2. On save, for an opted-in project only, the extension sends the file's current full text alongside the normal save event.
3. The **daemon** — not the extension — keeps the previous save's content in a bounded in-memory cache (max 500 files, oldest evicted first), diffs it against the new content (via the `diff` package), and immediately discards both raw versions. Only the diff is ever written to SQLite, and only after the same exclusion + redaction + 50KB-per-file cap Tier 1 uses.
4. The daemon re-checks `capture_save_diffs` itself before doing any of this — the extension's own gating is a courtesy that saves a read and a request, never the actual authority. A privacy-relevant decision is never trusted from the client alone.
5. The cache is memory-only: a daemon restart loses every baseline, so the first save after a restart has nothing to diff against and is silently skipped rather than guessed at.

IntelliJ has the same Tier 2 support as VS Code: `NarratelySaveListener` checks the daemon's capture-config (fetched every 60s by `NarratelyEventSink`, via a small purpose-built JSON parser rather than a new dependency) before ever reading `document.text`, and sends it as a `save_diff` event exactly like the VS Code extension does. Same server-side re-check, same size pre-check, same longest-enclosing-root-wins matching (a nested opted-out subdirectory correctly overrides a broader opted-in parent, on both sides).

### Tier 3 — aging raw diffs into local summaries

Both tiers above keep the full diff text indefinitely by default. `privacy.diff_retention_days` (null = keep forever) changes that: past the window, a background sweep replaces `diff_text` with a short local summary and discards the raw code — the row still exists, still shows up in a report or `narrately graph diffs`, it just stops carrying the code itself.

```yaml
privacy:
  diff_retention_days: 30   # null (default) = keep raw diff text forever
```

The summarizer (`src/core/summarize-diff.js`) is **regex, not an LLM** — it recognizes common function/class/import shapes across several languages (`function`/`def`/`func`/`fun`/`fn` declarations, `class`/`struct`/`interface`/`trait`, `import`/`require`/`use`/`#include`) and produces something like *"Added function login, processPayment; removed function oldAuth; 3 other lines changed."* Falls back to a plain line-count sentence when nothing recognizable is present. Same "safety net, not a guarantee" framing as `redact.js` — a best-effort compression step, not a real parser for any of these languages, and it runs with zero API keys configured so retention works the same whether or not you've set up an LLM provider.

The sweep runs on the daemon's existing 60-second poll loop, and again during `narrately report`'s own collection step (for the common case of not leaving the daemon running continuously) — both call the same `sweepDiffRetention()`, so a diff never gets summarized differently depending on which one caught it first.

### Where captured diffs show up

- **`narrately report --verbosity detailed`** (or `report.verbosity: detailed` in config) is the only place captured diff *text* reaches an LLM — bounded to 3 files per project and ~1500 characters per diff, so a handful of large commits can't blow out prompt size or cost. `brief`/`standard` reports never include diff content, even when it exists. The report's fallback (no-LLM) path lists captured files and their churn regardless of verbosity — it just can't narrate them without a model, so it points at `narrately graph diffs --full` instead of inlining the text.
- **The web dashboard**'s **Code changes** panel lists every captured diff in the selected window; click one to see the full (redacted) diff text in a modal. Backed by `GET /api/diffs` (list, no diff text — kept light) and `GET /api/diffs/:id` (full row, fetched on demand).
- **`narrately graph diffs [--project x] [--full]`** — the CLI equivalent, see above.

`narrately ask` / `narrately chat` do **not** currently pull diffs into their grounding context — that would need its own explicit opt-in, separate from `capture_diffs`, since chat context can end up quoted back in an answer more freely than a structured report section. Not implemented yet.

---

## Data model

Everything lives in `~/.narrately/` (override with `NARRATELY_HOME`).

```
~/.narrately/
  config.yaml          # chmod 600 — collectors, roots, exclusions, SMTP
  narrately.db            # SQLite: raw_events, sessions, nodes, edges, reports, notes, diffs, meta
  shell-history.log    # append-only, drained by the daemon
  reports/             # every generated report as Markdown
  logs/daemon.log
```

The graph is a plain node/edge table pair in SQLite. This is a deliberate cost decision: an LLM-driven temporal graph would pay extraction cost on **every ingested event**, whereas here the LLM only touches the graph at **report time**. Migration to a temporal engine is a later-phase concern, gated on evidence that multi-hop reasoning is actually needed.

The schema upgrades in place: opening a database created by an earlier version runs any pending `PRAGMA user_version`-gated migrations automatically (see `src/core/db.js`) — there is no "reset your data" step between versions. `test/migration.test.js` builds a v0.1-shaped database by hand and asserts the upgrade preserves every existing row.

---

## Privacy

- **Local-first by default.** Raw events, the graph, and reports never leave the machine unless you explicitly enable email delivery or the LLM narrative.
- **Metadata only, never source code — by default.** Collectors capture file paths, language ids, timestamps, commit subjects, and integer edit/diagnostic counts. File contents are never read, and edit volume is measured (line/character counts) without the changed text itself ever crossing the process boundary.
- **No command output.** The shell hook logs the command text and timestamp only — not what it printed, which is where secrets usually land.
- **User-defined exclusions** are applied at ingest, before anything is written to disk — including the v1.1 enricher events (edits, debug sessions, file ops) and captured diffs. Excluded content never reaches SQLite at all.
- **The LLM sees aggregated data only** — session durations, file paths, commit subjects, edit/debug counts. If that's still too much, the tool works without an API key.
- **The dashboard is loopback-only.** `narrately web` binds to `127.0.0.1`, the same trust boundary as the collector daemon — nothing it serves is reachable from another machine on the network.
- **Notes and [code change capture](#code-change-capture) are the two deliberate exceptions**, and both are opt-in. Notes are free text you choose to type into the dashboard. Diffs are real code content from your own commits, off by default per project, redacted for common secret patterns before storage, and never sent anywhere automatically — either way, Narrately never acts on this content without you asking it to.
- **`config.yaml` is written `chmod 600`** — a real restriction on macOS/Linux, but NTFS ignores POSIX mode bits, so on Windows this is not an enforced protection; anyone with access to your Windows user account can read it regardless. Treat your OS login as the actual boundary on Windows, same as for any other local dotfile.

Verified by test: see `test/privacy.test.js`, and the `PRIVACY CHECK` assertion in the end-to-end run.

---

## Scheduling

Delegated to native OS schedulers rather than an in-process timer, because those survive sleep, wake, and reboot:

| Platform | Mechanism                                    |
| -------- | -------------------------------------------- |
| Windows  | Task Scheduler task`Narrately-DailyReport` |
| macOS    | launchd agent`ai.narrately.dailyreport`    |
| Linux    | systemd user timer`narrately-report.timer` |

Both scheduled and manual modes call the **same** `generateReport()` function, so they can never drift apart.

---

## The IDE collectors

### VS Code (`integrations/vscode/`)

Plain JS, no build step. Hooks `onDidChangeActiveTextEditor` and `onDidSaveTextDocument` for focus/save, plus (v1.1) `onDidChangeTextDocument` for edit bursts, `onDidChangeDiagnostics` for error-count deltas, `onDidCreateFiles`/`onDidDeleteFiles`/`onDidRenameFiles` for structural changes, and `vscode.debug.onDidStartDebugSession`/`onDidTerminateDebugSession` for debug spans. The branch is read directly from `.git/HEAD` rather than depending on the built-in Git extension being enabled. Installed unpacked via `narrately install vscode` — Marketplace publishing is deferred until core reporting is validated.

### IntelliJ (`integrations/intellij/`)

Kotlin + Gradle, built on the IntelliJ Platform Plugin template. Subscribes to `FileEditorManagerListener` on the project message bus; `selectionChanged` captures created, closed, and switched editors in one hook. **Registered at project-startup time, not lazily** — that's what makes files already open when the project loads get captured, which is the common pitfall in this API. v1.1 adds a `DocumentListener` (edit bursts, via `EditorFactory`'s event multicaster) and an `XDebuggerManagerListener` (debug spans), both feeding a shared `NarratelyActivityTracker` service that also owns idle detection — the same backdated-truncation behavior as the VS Code extension. `NarratelySaveListener` additionally carries Tier 2 (uncommitted-work) diff capture — see [Code change capture](#code-change-capture) — including a small hand-rolled JSON parser (`NarratelyEventSink.kt`) for reading `GET /capture-config`, since the plugin otherwise has no JSON dependency to reach for.

It's a separate toolchain, so build it once:

```bash
cd integrations/intellij
./gradlew buildPlugin
narrately install intellij
```

`JAVA_HOME` must point at a JDK 17 for this — Gradle 9.6.1's own daemon (not just the compile target) needs to run on it. A too-new bundled JBR (e.g. an IDE's JetBrains Runtime 21+) crashes the Gradle daemon outright rather than just failing the build; the wrapper downloads its own Gradle distribution on first run but not a JDK. `./gradlew wrapper --gradle-version 9.6.1` regenerates `gradlew`/`gradlew.bat`/`gradle/wrapper/` if they're ever missing.

Works across IDEA, PyCharm, WebStorm, GoLand, RubyMine, and the rest of the family without per-IDE work, since they share the platform SDK.

---

## Tests

```bash
npm test
```

130 tests across sessionization (merging, gap-splitting, flicker rejection, save attribution), the v1.1 enrichers (edit bursts, per-file churn, debug spans, idle, diagnostics, file ops, branch), schema migration from a hand-built v0.1 database, idempotent repeated aggregation (no duplicate sessions or inflated graph weights), the expanded graph queries (`workSummary`, `timeline`, `topFiles`, `fileChurn`, `relatedProjects`, `search`, `comparePeriods`, `focusAnalysis`), the LLM provider registry (provider selection/fallback, per-provider API-key isolation, Gemini request/response handling and header-based auth), multi-turn chat (notes-aware context building, conversation-history threading through the Gemini provider, the `/api/chat` endpoint end-to-end), the web dashboard's HTTP API and notes CRUD, Tier 1 code change capture (secret redaction with false-positive checks, per-file exclusion, oversized-diff drop, idempotent re-scraping against a real throwaway git repo) and its surfacing (verbosity-gated prompt inclusion with length bounds, fallback-report listing, the `/api/diffs` endpoints, and an end-to-end regression test for diffs captured during a report's own collection step), Tier 2 uncommitted-work capture (baseline/no-baseline save handling, redaction, exclusion, server-side gating that ignores what the client claims, the bounded snapshot cache's eviction, and the real `/capture-config`/`/events` HTTP routes), Tier 3 retention (local summarizer coverage across several languages with false-positive checks, and the aging sweep's idempotency and no-op cases), privacy exclusion, project-root resolution, and Markdown/HTML rendering including HTML escaping. The IntelliJ plugin's Tier 2 support (a hand-rolled JSON parser and the same longest-enclosing-root matching as the JS side) is verified by a standalone compiled check outside this suite — the plugin has no Kotlin test harness set up.

---

## Roadmap scope

**MVP (v1.0):** VS Code + JetBrains focus/save activity, shell/terminal history, Git commits, local knowledge graph, manual and scheduled daily reports, optional email.

**v1.1 (this release):** Deeper IDE enrichers (edit volume, debug sessions, idle detection, diagnostics, file ops, branch context) and expanded graph queries (weekly rollups, timeline, related projects, search, period comparison, focus analysis), weekly reports, `narrately ask`, a pluggable LLM provider layer (Claude + Gemini today, see [LLM providers](#llm-providers)), per-file edit churn carried end-to-end instead of collapsed to project totals, a local web dashboard with notes and report history (see [Web dashboard](#web-dashboard)), multi-turn chat on both terminal and web grounded in your activity and your own notes (see [Chat](#chat--multi-turn-on-your-notes-too)), and opt-in, redacted, three-tier code change capture — your own git commits, your uncommitted in-progress work, and a local, non-LLM retention sweep that ages raw diff text into short summaries (see [Code change capture](#code-change-capture)).

**Out of scope for v1.1 (later phases per the roadmap):** other editors (Vim/Neovim, Sublime, Xcode), non-developer tools, MCP server integrations (Jira, Linear, Slack, GitHub Issues), migrating the graph layer to a temporal engine, team/multi-user features, mobile, and pulling captured diffs into `narrately ask`/`narrately chat`'s grounding context (would need its own explicit opt-in, separate from `capture_diffs`).
