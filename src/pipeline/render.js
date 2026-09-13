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
    } else {
      closeList();
      out.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }
  closeList();
  closeTable();

  return out.join('\n');
}

export function renderEmailHtml(markdown, { title = 'Narrately' } = {}) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; padding: 0; background: #f6f7f9; }
  .narrately-shell { max-width: 640px; margin: 0 auto; padding: 24px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .narrately-brand { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .narrately-brand-mark { width: 22px; height: 22px; border-radius: 6px; background: #4f46e5; flex: none; }
  .narrately-brand-name { font-size: 14px; font-weight: 600; letter-spacing: 0.01em; color: #1a1a1a; }
  .narrately-card { background: #ffffff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 28px; font-size: 15px; line-height: 1.6; color: #1a1a1a; }
  .narrately-report h1 { font-size: 20px; margin: 0 0 16px; }
  .narrately-report h2 { font-size: 16px; margin: 24px 0 8px; padding-top: 12px; border-top: 1px solid #eceef1; }
  .narrately-report h2:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .narrately-report h3 { font-size: 14px; margin: 16px 0 4px; }
  .narrately-report p { margin: 0 0 12px; }
  .narrately-report ul { margin: 0 0 12px; padding-left: 20px; }
  .narrately-report li { margin: 4px 0; }
  .narrately-report table { width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px; }
  .narrately-report th, .narrately-report td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eceef1; }
  .narrately-report th { color: #6b7280; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em; }
  .narrately-report code { background: #f1f2f4; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
  .narrately-report hr { border: none; border-top: 1px solid #eceef1; margin: 20px 0; }
  .narrately-footer { margin-top: 16px; font-size: 12px; color: #8a8f98; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1115; }
    .narrately-brand-name { color: #e6e8eb; }
    .narrately-card { background: #171a21; border-color: #262b35; color: #e6e8eb; }
    .narrately-report h2 { border-top-color: #262b35; }
    .narrately-report th { color: #9aa1ac; }
    .narrately-report th, .narrately-report td { border-bottom-color: #262b35; }
    .narrately-report code { background: #23272f; color: #e6e8eb; }
    .narrately-report hr { border-top-color: #262b35; }
    .narrately-footer { color: #6b7280; }
  }
</style>
</head>
<body>
<div class="narrately-shell">
  <div class="narrately-brand">
    <span class="narrately-brand-mark"></span>
    <span class="narrately-brand-name">Narrately</span>
  </div>
  <div class="narrately-card">
    <div class="narrately-report">
      ${markdownToHtml(markdown)}
    </div>
  </div>
  <p class="narrately-footer">
    Generated locally by Narrately. Your activity data never left your machine except to produce this email.
  </p>
</div>
</body>
</html>`;
}
