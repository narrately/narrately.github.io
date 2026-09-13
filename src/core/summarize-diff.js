
const FUNCTION_DECL = /\b(?:function|def|func|fun|fn)\s+([A-Za-z_$][\w$]*)\s*\(/;
const ARROW_CONST_DECL = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/;
const CLASS_DECL = /\b(?:class|struct|interface|trait)\s+([A-Za-z_$][\w$]*)/;
const IMPORT_LIKE = /^\s*(?:import\b|from\s+\S+\s+import\b|const\s+.+=\s*require\(|use\s+\S+;|#include\b)/;

function classifyLine(content) {
  const fn = content.match(FUNCTION_DECL) ?? content.match(ARROW_CONST_DECL);
  if (fn) return { kind: 'function', name: fn[1] };

  const cls = content.match(CLASS_DECL);
  if (cls) return { kind: 'class', name: cls[1] };

  if (IMPORT_LIKE.test(content)) return { kind: 'import' };

  return null;
}

export function summarizeDiff(diffText) {
  if (!diffText) return null;

  const added = { functions: new Set(), classes: new Set(), imports: 0 };
  const removed = { functions: new Set(), classes: new Set(), imports: 0 };
  let otherAdded = 0;
  let otherRemoved = 0;

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    const isAdd = raw.startsWith('+');
    const isRemove = raw.startsWith('-');
    if (!isAdd && !isRemove) continue;

    const content = raw.slice(1);
    const classified = classifyLine(content);
    const bucket = isAdd ? added : removed;

    if (classified?.kind === 'function') bucket.functions.add(classified.name);
    else if (classified?.kind === 'class') bucket.classes.add(classified.name);
    else if (classified?.kind === 'import') bucket.imports++;
    else if (isAdd) otherAdded++;
    else otherRemoved++;
  }

  const parts = [];
  if (added.functions.size) parts.push(`added function${added.functions.size === 1 ? '' : 's'} ${[...added.functions].join(', ')}`);
  if (removed.functions.size) parts.push(`removed function${removed.functions.size === 1 ? '' : 's'} ${[...removed.functions].join(', ')}`);
  if (added.classes.size) parts.push(`added ${[...added.classes].join(', ')}`);
  if (removed.classes.size) parts.push(`removed ${[...removed.classes].join(', ')}`);
  if (added.imports || removed.imports) {
    const bits = [];
    if (added.imports) bits.push(`+${added.imports}`);
    if (removed.imports) bits.push(`-${removed.imports}`);
    parts.push(`changed imports (${bits.join('/')})`);
  }

  const otherTotal = otherAdded + otherRemoved;
  if (parts.length && otherTotal) {
    parts.push(`${otherTotal} other line${otherTotal === 1 ? '' : 's'} changed`);
  } else if (!parts.length && otherTotal) {
    parts.push(`${otherAdded} line(s) added, ${otherRemoved} removed`);
  }

  if (!parts.length) return null;
  const sentence = parts.join('; ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}
