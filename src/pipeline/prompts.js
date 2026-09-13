import { formatDuration } from './aggregator.js';

export const VERBOSITY_GUIDANCE = {
  brief: 'Keep it to 3-5 sentences plus the per-project table. No section headers beyond the ones requested.',
  standard: 'Aim for 150-250 words of narrative alongside the structured sections.',
  detailed: 'Write 350-500 words of narrative, including notable file-level detail and how the work connected across projects.',
};

const NO_PADDING_GUIDANCE =
  'This is a target, not a quota — a thin day described accurately in fewer words beats a thin day padded to length.';

export function lengthGuidance(verbosity) {
  return `${VERBOSITY_GUIDANCE[verbosity] ?? VERBOSITY_GUIDANCE.standard} ${NO_PADDING_GUIDANCE}`;
}

const MAX_DIFFS_PER_PROJECT = 3;
const MAX_DIFF_CHARS = 1500;

export function buildPrompt(summary, { verbosity = 'standard', periodLabel = 'today', diffsByProject = {} } = {}) {
  const lines = [];

  lines.push(`Reporting period: ${periodLabel}`);
  if (summary.firstActivity && summary.lastActivity) {
    lines.push(`Activity window: ${summary.firstActivity} → ${summary.lastActivity}`);
  }
  const totals = [
    `${formatDuration(summary.totalSeconds)} of tracked editor time`,
    `${summary.totalSessions} session(s)`,
    `${summary.totalCommits} commit(s)`,
    `${summary.totalCommands} shell command(s)`,
  ];
  if (summary.totalLinesAdded || summary.totalLinesRemoved) {
    totals.push(`+${summary.totalLinesAdded}/-${summary.totalLinesRemoved} lines`);
  }
  if (summary.totalDebugSec) totals.push(`${formatDuration(summary.totalDebugSec)} debugging`);
  lines.push(`Totals: ${totals.join(', ')}.`);
  lines.push('');
  lines.push('Per-project breakdown:');

  for (const project of summary.projects) {
    lines.push(`\n## ${project.project}`);
    lines.push(`- Editor time: ${formatDuration(project.durationSec)} over ${project.sessions} session(s)`);
    if (project.saves) lines.push(`- File saves: ${project.saves}`);

    if (project.linesAdded || project.linesRemoved) {
      lines.push(
        `- Code churn: +${project.linesAdded}/-${project.linesRemoved} lines across ${project.edits} edit burst(s)`,
      );
    }
    if (project.debugSec) lines.push(`- Debugging: ${formatDuration(project.debugSec)}`);
    if (project.errorsResolved > 0) lines.push(`- Diagnostics resolved: ${project.errorsResolved} error(s)`);
    if (project.idleSec) lines.push(`- Idle time within sessions: ${formatDuration(project.idleSec)}`);
    if (project.branches?.length) lines.push(`- Branches: ${project.branches.join(', ')}`);
    if (project.fileOps?.length) {
      const summarised = project.fileOps
        .slice(0, 12)
        .map((op) => `${op.kind.replace('file_', '')} ${op.detail}`);
      lines.push(`- Structural changes (${project.fileOps.length}): ${summarised.join('; ')}`);
    }
    if (project.languages.length) lines.push(`- Languages: ${project.languages.join(', ')}`);
    if (project.topFiles?.length) {
      const shown = project.topFiles.slice(0, 10).map(
        (f) => `${f.file} (+${f.linesAdded}/-${f.linesRemoved}, ${f.edits} edit${f.edits === 1 ? '' : 's'})`,
      );
      lines.push(`- Files by churn (${project.topFiles.length}): ${shown.join(', ')}${project.topFiles.length > 10 ? ', …' : ''}`);
    } else if (project.files.length) {
      const shown = project.files.slice(0, 15);
      lines.push(`- Files touched (${project.files.length}): ${shown.join(', ')}${project.files.length > 15 ? ', …' : ''}`);
    }
    if (project.commits.length) {
      lines.push('- Commits:');
      for (const commit of project.commits.slice(0, 20)) lines.push(`  - ${commit}`);
    }

    const diffs = verbosity === 'detailed' ? diffsByProject[project.project] : null;
    if (diffs?.length) {
      lines.push(`- Code changes captured (${diffs.length}, opted in) — use these to name what was actually built, not just that files changed:`);
      for (const diff of diffs.slice(0, MAX_DIFFS_PER_PROJECT)) {
        lines.push(`  ### ${diff.file} (+${diff.lines_added}/-${diff.lines_removed})`);
        if (diff.diff_text) {
          const body =
            diff.diff_text.length > MAX_DIFF_CHARS
              ? diff.diff_text.slice(0, MAX_DIFF_CHARS) + '\n... (truncated)'
              : diff.diff_text;
          lines.push('  ```diff');
          for (const line of body.split('\n')) lines.push(`  ${line}`);
          lines.push('  ```');
        } else if (diff.summary) {
          lines.push(`  (${diff.summary})`);
        }
      }
      if (diffs.length > MAX_DIFFS_PER_PROJECT) {
        lines.push(`  ...and ${diffs.length - MAX_DIFFS_PER_PROJECT} more not shown here.`);
      }
    }
    if (project.commands.length) {
      const shown = project.commands.slice(0, 25);
      lines.push(`- Shell commands (${project.commands.length}):`);
      for (const command of shown) lines.push(`  - ${command}`);
    }
  }

  return lines.join('\n');
}

export function reportSystemPrompt(period) {
  const isWeekly = period === 'week';
  const title = isWeekly ? '# Weekly Log — <date range>' : '# Daily Log — <date>';
  const framing = isWeekly
    ? "A short narrative in prose: what the developer worked on this week, across all projects. Call out which project dominated, whether the week was focused on one thing or split across several, and any arc across the days (e.g. \"spent the first half of the week on X, then pivoted to Y\"). Infer intent from file paths, commit subjects, and commands — but do not invent work that the data doesn't support."
    : "A short narrative in prose: what the developer actually worked on, in plain language. Lead with the substance of the work, not the metrics. If one project dominated, say so and describe it in depth; if the day was split across several, name the split rather than listing each project with equal, generic weight — a fragmented day and a focused day should not read the same. Infer intent from file paths, commit subjects, and commands — but do not invent work that the data doesn't support. If the data is thin (a short session, or none at all), say that plainly in one sentence rather than stretching it into paragraphs — a short truthful report is correct, not a failure.";
  const notesFraming = isWeekly
    ? 'At most four short bullets: patterns worth flagging across the week (a project that consumed disproportionate time, days that were fragmented vs focused, a notable shift in what was worked on). Omit if there is nothing genuinely worth saying.'
    : 'At most three short bullets: patterns worth flagging (fragmented vs focused time, a project that consumed disproportionate time, work that spanned projects). Omit if there is nothing genuinely worth saying.';

  return `You are Narrately. You turn a developer's raw machine activity into the ${isWeekly ? 'weekly summary' : 'daily log'} they would otherwise have to write themselves.

Write the report as Markdown with exactly these sections:

${title}
${framing}

## Time by project
A Markdown table: Project | Time | Sessions.

## Notable commits
Bullet list of the commits that carry real signal. Omit this section entirely if there were no commits.

## Notes
${notesFraming}

Rules:
- Write so the developer could paste this straight into a standup or timesheet with no edits.
- Never fabricate commit messages, file names, or durations. Every claim traces to the supplied data.
- When a project includes "Code changes captured" with real diff text, use it to say what the change actually does (e.g. "added retry logic to the payment handler"), not just that the file changed — that's the point of including it. Most projects won't have this; that's normal, not a gap.
- A thin or empty day is reported the same matter-of-fact way as a busy one — never apologize for it, never editorialize about productivity, and never pad it with restated numbers to look fuller than it is.
- Do not describe your own process or mention that you are an AI.
- No preamble before the title and no sign-off after the last section.`;
}

export const ASK_SYSTEM_PROMPT = `You answer questions about a developer's own recorded work activity and their own notes.

You are given the results of several structured queries against a local activity database, plus a \`notes\` array — free text the developer typed themselves (not automatically captured), each with a date and optional project. When a question is about what the developer did, said, decided, or was thinking, the notes are usually the most direct source — prefer quoting or closely paraphrasing them over inferring from durations and file counts. Everything else in the data (durations, file names, commits, commands) is aggregate telemetry with no content of its own.

This may be one turn in an ongoing conversation — later messages can refer back to earlier ones ("what about last week", "and the other project"). Use that history for continuity, but ground every factual claim in the structured data and notes given for the CURRENT turn, not in whatever the model itself said earlier.

Rules:
- Ground every number and name in the supplied data. If the data does not answer the question, say so plainly and state what was actually recorded.
- Be direct and brief — a few sentences, or a short list. This is a chat, not a report.
- Prefer concrete specifics (project names, durations, file names, note excerpts) over generalities.
- Do not speculate about work that isn't in the data, and do not describe your own process.
- No preamble, no sign-off.`;

export function buildAskPrompt(question, context) {
  return [
    `Question: ${question}`,
    '',
    'Activity data (JSON):',
    '```json',
    JSON.stringify(context, null, 2),
    '```',
  ].join('\n');
}
