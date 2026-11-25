# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The product itself is a Node CLI plus editor extensions; every designed surface is web: the public site (`website/index.html`, `website/docs.html`, GitHub Pages), the local dashboard served by `narrately web` (`src/web/dashboard.html`, 127.0.0.1:47830), and the team portal served by `narrately cloud dashboard` or hosted statically (`cloud/dashboard/index.html`, 127.0.0.1:5544).

## Users

- **Individual developers** who have to say what they did: standups, async updates, timesheets and invoices, performance reviews, handoffs, or getting back up to speed after time away. They live in an editor, a terminal and Git, and they don't want to rebuild their day from memory at 9am.
- **Team owners and managers** on the paid Narrately Cloud tier. They want the team's week by person and project without holding a status meeting. Some of them never use the CLI and sign in through the team portal only.

_Inferred from the repository copy and earlier conversation, not from a separate interview: the relative weight of the two groups (individuals are treated as the primary audience, teams as the upsell)._

## Product Purpose

Narrately turns IDE, terminal and Git activity into a written daily or weekly log. A local daemon collects metadata, a pipeline rolls it into sessions and a local knowledge graph, and an LLM (Claude or Gemini) writes it up as prose. With no API key, reports still come out, just structured instead of narrated. Success means the developer pastes the log instead of writing it, and trusts it because it's grounded in what actually happened.

## Positioning

- Local-first by architecture, not by setting: the daemon binds to loopback, and only metadata is stored by default (paths, timestamps, commit subjects, integer counts, never file contents). Nothing leaves the machine unless the user turns on email delivery, an LLM narrative, or a team.
- Writes prose, not just dashboards of time. The narrative is the product; the charts back it up.
- Project context: users describe each project (a `.narrately.md`, a linked doc, or text), so the writing uses the project's real names and goals.
- Open core: the CLI, both editor extensions and the local dashboard are free and MIT licensed. Narrately Cloud (team rollups) is the paid tier.

## Operating Context

- Install: `npm install -g narrately`, then `narrately onboard` and `narrately daemon start`. Node ≥ 22.5. Windows, macOS, Linux.
- Collectors: the VS Code extension, the JetBrains plugin (IDEA, WebStorm, PyCharm, GoLand, RubyMine), a shell hook (PowerShell, zsh, bash, fish), and Git. All of them report to the same local daemon.
- Daily commands: `report`, `report --week`, `ask`, `chat`, `web`, `context`, `graph`, `config`, `status`, `schedule`, `sync`, `cloud …`.
- Local dashboard: overview (totals, compare to the previous period, per-project time, timeline, files, focus), journal/notes, an assistant chat, report history and diffs, and a project-context editor with .md upload. A developer keeps it open in a browser tab next to their editor.
- Team portal: sign in or sign up, create or join a team with an invite code, a weekly view by member and project, members and invites (owner), CSV timesheet export, trial/billing notice, and an upgrade to Stripe Checkout (owner).
- Docs: installation, onboarding, commands, configuration, privacy model, code-change-capture tiers, project context, teams.

## Capabilities and Constraints

- Code change capture is opt-in, in three tiers (commits, uncommitted work per project, retention that ages diffs into summaries), with secrets redacted before anything is written to disk.
- Cloud sync sends session metadata only (project label, start/end, duration, languages, save/edit counts, lines added/removed), never paths, diffs, commit messages, notes or code. The daemon auto-syncs every 15 minutes.
- Teams: 14-day free trial per org. After it ends, or after cancellation, past rollups stay readable but new syncs are blocked. Seat billing through Stripe Checkout, one seat per current member.
- Surfaces are dependency-free static HTML/CSS/JS (no framework, no build step). Fonts and assets are self-hosted per surface folder (`website/assets`, `src/web/assets`, `cloud/dashboard/assets`). The local dashboard and team portal must work offline from the CLI's own server. The team portal loads supabase-js from a CDN and a generated `config.js`.
- The local dashboard's and team portal's JS bind to existing element IDs and API routes; a redesign keeps that behavior.
- Undecided: the seat price is not public (the README uses "$10/seat/month" only as an example). Don't state a price.

## Brand Commitments

- Name: **Narrately**, written lowercase `narrately` in the wordmark and CLI.
- Logo mark: an "N" built from two stems and a dotted diagonal (`brand/narrately-mark.svg`). It also ships as the VS Code icon, the JetBrains plugin icon and in report emails. The shape is the asset; its colors follow the visual system.
- Voice: plain, direct, specific, a little dry ("Your day, already written." / "Stop trying to remember what you did."). It explains mechanisms instead of hyping them.
- User directive (2026-11-25): the UI must not feel AI-generated.

## Evidence on Hand

- Real: the command set and output shapes, the privacy guarantees (all backed by code in the repo), supported editors and shells, the pipeline (collectors → daemon → aggregator → graph → narrative), the open-source repo (github.com/narrately/narrately.github.io), MIT license, version 1.2.
- Demonstration data in the current surfaces (auth-service, billing-api, "Acme Engineering", member hours) is synthetic and must stay labeled or obviously illustrative.
- Absent, and not to be fabricated: testimonials, customer logos, user or download counts, benchmarks, press, a public price.

## Product Principles

1. Show the written log. The prose output is the proof; every surface should get to it fast.
2. Trust is structural. Privacy claims are stated as mechanisms you can verify in code, never as reassurance copy.
3. The free local tool is complete on its own. Teams is an add-on, never a gate.
4. Respect the working session. The dashboards are tools you glance at between tasks; they shouldn't demand attention.
5. Specific beats impressive. Real commands, real file names, real numbers, never vague capability claims.
