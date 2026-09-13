# website/

Static, self-contained landing page (`index.html`) and documentation
(`docs.html`) for Narrately — matches what's live in the Claude artifacts, with
the cross-links between them rewritten to relative paths and the artifact
platform's injected runtime stripped out. No build step, no dependencies,
fonts embedded as base64 — either file works by itself, opened directly from
disk or served from anywhere.

## Enable GitHub Pages

A workflow at `.github/workflows/deploy-pages.yml` already deploys this
folder on every push to `main` that touches `website/`. One-time setup after
you push:

1. GitHub → repo → **Settings → Pages**
2. Under **Build and deployment → Source**, choose **GitHub Actions**
3. Push to `main` (or run the workflow manually from the **Actions** tab)

The site will be live at `https://<your-username>.github.io/<repo-name>/`.

## Updating content

These files are generated from the live artifacts, not hand-edited in place —
regenerating means re-exporting the current artifact content and re-applying
the same relative-link rewrite (`docs.html` ↔ `index.html`) rather than
editing `index.html`/`docs.html` directly, or the two will drift from what's
published on claude.ai.

## Once Pages is live

The main `README.md`'s documentation link currently points at the claude.ai
docs artifact. Once this is deployed, swap it to the real Pages URL if you'd
rather link the permanent site instead.
