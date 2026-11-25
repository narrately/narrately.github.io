import { formatDuration } from './aggregator.js';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-CA');
}

export function renderFallbackMarkdown(
  summary,
  { periodLabel = 'today', periodEnd, periodStart = null, period = 'day', diffsByProject = {} } = {},
) {
  const lines = [];
  const date = formatDate(periodEnd ?? summary.lastActivity ?? new Date().toISOString());

  if (period === 'week' && periodStart) {
    lines.push(`# Weekly Log — ${formatDate(periodStart)} to ${date}`);
  } else {
    lines.push(`# Daily Log — ${date}`);
  }
  lines.push('');

  if (!summary.projects.length) {
    lines.push(`No tracked activity for ${periodLabel}.`);
    lines.push('');
    lines.push('If you expected activity here, check `narrately status` — the collector daemon may not be running.');
    return lines.join('\n');
  }

  const top = summary.projects[0];
  lines.push(
    `${formatDuration(summary.totalSeconds)} of tracked editor time across ` +
      `${summary.projects.length} project(s) in ${summary.totalSessions} session(s), ` +
      `with ${summary.totalCommits} commit(s) and ${summary.totalCommands} shell command(s). ` +
      `Most of the time went to **${top.project}** (${formatDuration(top.durationSec)}).`,
  );
  lines.push('');

  const hasChurn = summary.projects.some((project) => project.linesAdded || project.linesRemoved);

  lines.push('## Time by project');
  lines.push('');
  lines.push(hasChurn ? '| Project | Time | Sessions | Lines |' : '| Project | Time | Sessions |');
  lines.push(hasChurn ? '| --- | --- | --- | --- |' : '| --- | --- | --- |');
  for (const project of summary.projects) {
    const base = `| ${project.project} | ${formatDuration(project.durationSec)} | ${project.sessions} |`;
    lines.push(hasChurn ? `${base} +${project.linesAdded}/-${project.linesRemoved} |` : base);
  }
  lines.push('');

  const topFiles = summary.projects
    .flatMap((project) => (project.topFiles ?? []).map((f) => ({ project: project.project, ...f })))
    .sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved))
    .slice(0, 10);
  if (topFiles.length) {
    lines.push('## Top files by churn');
    lines.push('');
    for (const f of topFiles) {
      lines.push(`- **${f.file}** (${f.project}) — +${f.linesAdded}/-${f.linesRemoved}, ${f.edits} edit${f.edits === 1 ? '' : 's'}`);
    }
    lines.push('');
  }

  const capturedDiffs = Object.entries(diffsByProject).flatMap(([project, rows]) =>
    rows.map((row) => ({ project, ...row })),
  );
  if (capturedDiffs.length) {
    lines.push('## Code changes captured');
    lines.push('');
    for (const d of capturedDiffs.slice(0, 10)) {
      lines.push(`- **${d.file}** (${d.project}) — +${d.lines_added}/-${d.lines_removed}${d.redacted ? ' _(redacted)_' : ''}`);
    }
    if (capturedDiffs.length > 10) lines.push(`- …and ${capturedDiffs.length - 10} more`);
    lines.push('');
    lines.push('_Run `narrately graph diffs --full` to read the captured diff text._');
    lines.push('');
  }

  const commits = summary.projects.flatMap((project) =>
    project.commits.map((commit) => ({ project: project.project, commit })),
  );
  if (commits.length) {
    lines.push('## Notable commits');
    lines.push('');
    for (const { project, commit } of commits) lines.push(`- **${project}** — ${commit}`);
    lines.push('');
  }

  const languages = [...new Set(summary.projects.flatMap((project) => project.languages))];
  const notes = [];
  if (languages.length) notes.push(`Languages touched: ${languages.join(', ')}`);
  if (summary.totalDebugSec) {
    notes.push(`Spent ${formatDuration(summary.totalDebugSec)} in debug sessions.`);
  }
  if (summary.totalErrorsResolved > 0) {
    notes.push(`Resolved ${summary.totalErrorsResolved} reported error(s).`);
  }
  const branches = [...new Set(summary.projects.flatMap((project) => project.branches ?? []))];
  if (branches.length > 1) notes.push(`Worked across branches: ${branches.join(', ')}`);
  if (summary.projects.length > 2) {
    notes.push(`Work was split across ${summary.projects.length} projects — a fragmented day.`);
  }

  if (notes.length) {
    lines.push('## Notes');
    lines.push('');
    for (const note of notes) lines.push(`- ${note}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_Generated without an LLM (no `ANTHROPIC_API_KEY` set). Set the key for a written narrative._');

  return lines.join('\n');
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

export function markdownToHtml(markdown) {
  const out = [];
  const lines = markdown.split('\n');
  let listOpen = false;
  let tableRows = null;

  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };
  const closeTable = () => {
    if (!tableRows) return;
    const [header, ...body] = tableRows;
    out.push('<table><thead><tr>');
    for (const cell of header) out.push(`<th>${inlineMarkdown(cell)}</th>`);
    out.push('</tr></thead><tbody>');
    for (const row of body) {
      out.push('<tr>');
      for (const cell of row) out.push(`<td>${inlineMarkdown(cell)}</td>`);
      out.push('</tr>');
    }
    out.push('</tbody></table>');
    tableRows = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith('|')) {
      const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((cell) => cell.trim());
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      closeList();
      tableRows ??= [];
      tableRows.push(cells);
      continue;
    }
    closeTable();

    if (!line.trim()) {
      closeList();
      continue;
    }
    if (line.startsWith('### ')) {
      closeList();
      out.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      out.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      out.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (/^[-*] /.test(line.trim())) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inlineMarkdown(line.trim().slice(2))}</li>`);
    } else if (/^-{3,}$/.test(line.trim())) {
      closeList();
      out.push('<hr>');
    } else if (/^_.+_$/.test(line.trim())) {
      closeList();
      out.push(`<p class="note"><em>${inlineMarkdown(line.trim().slice(1, -1))}</em></p>`);
    } else {
      closeList();
      out.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  closeTable();

  return out.join('\n');
}

// Email clients ignore web fonts, block SVG and data-URI images, and (in
// Outlook) flexbox — so the brand is built from tables, a CSS-drawn logo
// tile, and a condensed system face standing in for the one used on the web.
export function renderEmailHtml(markdown, { title = 'Narrately', date = new Date() } = {}) {
  const dateLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 0; background: #F6F7F2; -webkit-text-size-adjust: 100%; }
  .n-shell { width: 100%; background: #F6F7F2; }
  .n-wrap { max-width: 640px; margin: 0 auto; padding: 28px 16px 36px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .n-head td { vertical-align: middle; }
  .n-mark { width: 28px; height: 28px; border-radius: 6px; background: #1C1F22; color: #F6F7F2; font: 800 15px/28px -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; text-align: center; }
  .n-word { padding-left: 9px; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; color: #171A1C; }
  .n-date { text-align: right; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #3B7650; }
  .n-card { margin-top: 18px; background: #FFFFFF; border: 1px solid #C9CEC6; }
  .n-bar { height: 2px; background: #171A1C; font-size: 0; line-height: 0; }
  .n-body { padding: 30px 32px 26px; font-size: 15.5px; line-height: 1.65; color: #171A1C; }
  .n-body h1 { font-family: 'Barlow Semi Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif; font-weight: 700; font-size: 32px; line-height: 1.05; letter-spacing: -0.02em; margin: 0 0 18px; color: #171A1C; }
  .n-body h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 26px 0 10px; padding-top: 16px; border-top: 1px dashed #BED3C1; color: #171A1C; }
  .n-body h3 { font-size: 14px; margin: 18px 0 6px; }
  .n-body p { margin: 0 0 13px; }
  .n-body strong { color: #171A1C; }
  .n-body ul { margin: 0 0 13px; padding-left: 20px; }
  .n-body li { margin: 5px 0; }
  .n-body table { width: 100%; border-collapse: collapse; margin: 2px 0 16px; font-size: 14px; }
  .n-body th { text-align: left; padding: 8px 10px 8px 0; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 10.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #646B70; border-bottom: 1.5px solid #171A1C; }
  .n-body td { padding: 9px 10px 9px 0; border-bottom: 1px solid #E3E7E0; }
  .n-body code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 12.5px; background: #ECEFE7; border: 1px solid #DDE2D9; padding: 1px 5px; }
  .n-body hr { border: none; border-top: 1px dashed #BED3C1; margin: 22px 0; }
  .n-body .note { color: #646B70; font-size: 13px; }
  .n-foot { padding: 18px 8px 0; font-size: 12px; line-height: 1.6; color: #646B70; text-align: center; }
  .n-foot b { color: #444A4E; font-weight: 600; }
  @media (max-width: 520px) {
    .n-body { padding: 24px 20px 20px; font-size: 15px; }
    .n-body h1 { font-size: 27px; }
    .n-date { display: none; }
  }
  @media (prefers-color-scheme: dark) {
    body, .n-shell { background: #121513 !important; }
    .n-word, .n-body, .n-body h1, .n-body h2, .n-body strong { color: #E8ECE6 !important; }
    .n-mark { border: 1px solid #2D3831; }
    .n-card { background: #171B18 !important; border-color: #2D3831 !important; }
    .n-bar { background: #E8ECE6 !important; }
    .n-body h2, .n-body td, .n-body hr { border-color: #2D3831 !important; }
    .n-body th { border-color: #8F9891 !important; color: #8F9891 !important; }
    .n-body code { background: #1B1F1C !important; border-color: #2D3831 !important; color: #E8ECE6 !important; }
    .n-date { color: #7FB592 !important; }
    .n-body .note, .n-foot { color: #8F9891 !important; }
    .n-foot b { color: #B4BCB5 !important; }
  }
</style>
</head>
<body>
<div class="n-shell">
  <div class="n-wrap">
    <table class="n-head" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="28"><div class="n-mark">N</div></td>
        <td class="n-word">narrately</td>
        <td class="n-date">${escapeHtml(dateLabel)}</td>
      </tr>
    </table>
    <div class="n-card">
      <div class="n-bar">&nbsp;</div>
      <div class="n-body">
        ${markdownToHtml(markdown)}
      </div>
    </div>
    <p class="n-foot">
      <b>Written on your machine by Narrately.</b><br>
      Your activity data never left it except to produce this email.
    </p>
  </div>
</div>
</body>
</html>`;
}
