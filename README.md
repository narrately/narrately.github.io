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
narrately graph week          # query the activity graph directly
narrately config list         # view or edit any setting
```

## Editor integrations

```bash
narrately install vscode      # or: intellij, shell
```

VS Code and JetBrains (IDEA, WebStorm, PyCharm, GoLand, RubyMine) are thin producers — they report focus, saves, and edits to the same local daemon the CLI runs.

## Documentation

Full docs — installation, onboarding, commands, configuration, privacy model, and the code-change-capture tiers: **[Narrately Documentation](https://claude.ai/code/artifact/ca56c402-9e92-4550-8403-37cbf357a640)**

## Privacy

Metadata only by default — file paths, timestamps, commit subjects, integer counts, never file contents. Code change capture is a separate, opt-in, redacted exception. Details in the docs above.

## Tests

```bash
npm test
```

## License

MIT
