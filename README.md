# Narrately

Turns your IDE, terminal, and Git activity into a written daily log — for standups, timesheets, reviews, or just remembering what you built.

Local-first: everything stays on your machine unless you turn on email delivery or an LLM narrative.

## Install

```bash
npm install -g narrately
narrately onboard
narrately daemon start
```

Set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` for a written narrative. Without a key, reports still generate — just structured instead of narrated.

## Usage

```bash
narrately report              # generate a report
narrately report --week       # weekly, cross-project rollup
narrately ask "what did I work on this week"
narrately chat                # multi-turn conversation
narrately web                 # local dashboard
narrately context edit api    # describe a project so reports use its real names and goals
narrately graph week          # query the activity graph directly
narrately config list         # view or edit any setting
```

## Project context

Reports only see metadata (files, times, commits), so tell Narrately what each project *is* — its goals, what its folders mean, its internal names — and the narrative, `ask`, and `chat` will use it:

```bash
narrately context edit api                 # write it in your editor, from a template
narrately context set api --link docs/ARCHITECTURE.md   # re-read on every report
narrately context set api --file brief.md  # one-time copy
```

Or drop a `.narrately.md` in the project's root folder — it's picked up automatically. The dashboard (`narrately web`) has an editor with .md upload. Context stays local; it's sent to your LLM provider only alongside the activity it explains, and never synced to Narrately Cloud.

## Editor integrations

```bash
narrately install vscode      # or: intellij, shell
```

VS Code and JetBrains (IDEA, WebStorm, PyCharm, GoLand, RubyMine) are thin producers — they report focus, saves, and edits to the same local daemon the CLI runs.

## Teams (optional, paid)

```bash
narrately cloud login
narrately cloud join <invite-code>   # or: narrately cloud create-org "Acme"
narrately cloud dashboard            # open the team portal
```

Team members' session metadata (project, time, line counts — never paths or code) rolls up into a shared dashboard. Setup in [cloud/README.md](cloud/README.md).

## Documentation

Full docs — installation, onboarding, commands, configuration, privacy model, and the code-change-capture tiers: **[Narrately Documentation](https://narrately.github.io/docs.html)**

## Privacy

Metadata only by default — file paths, timestamps, commit subjects, integer counts, never file contents. Code change capture is a separate, opt-in, redacted exception. Details in the docs above.

## Tests

```bash
npm test
```

## License

MIT
