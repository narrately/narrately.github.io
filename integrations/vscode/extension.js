const vscode = require('vscode');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const FLUSH_INTERVAL_MS = 10_000;
const EDIT_BURST_MS = 60_000;
const IDLE_CHECK_MS = 30_000;
const MAX_QUEUE = 500;

let queue = [];
let flushTimer = null;
let burstTimer = null;
let idleTimer = null;
let captureConfigTimer = null;
let statusBarItem = null;
let stats = { sent: 0, failed: 0, dropped: 0, edits: 0 };

let currentFocus = null;
let lastActivityAt = Date.now();
let isIdle = false;
let idleStartedAt = null;

const pendingEdits = new Map();
const lastErrorCounts = new Map();

function config() {
  return vscode.workspace.getConfiguration('narrately');
}

function isEnabled() {
  return config().get('enabled', true);
}

function idleThresholdMs() {
  return Math.max(60, config().get('idleThresholdSeconds', 300)) * 1000;
}

function excludedPatterns() {
  const raw = config().get('excludedPatterns', []) || [];
  return raw
    .map((pattern) => {
      try {
        return new RegExp(pattern, 'i');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const branchCache = new Map();
function currentBranch(workspaceRoot) {
  if (!workspaceRoot) return null;
  const cached = branchCache.get(workspaceRoot);
  if (cached && Date.now() - cached.readAt < 30_000) return cached.branch;

  let branch = null;
  try {
    const head = fs.readFileSync(path.join(workspaceRoot, '.git', 'HEAD'), 'utf8').trim();
    const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    branch = match ? match[1] : head.slice(0, 8);
  } catch {
    branch = null;
  }
  branchCache.set(workspaceRoot, { branch, readAt: Date.now() });
  return branch;
}

function describe(document) {
  if (!document || document.isUntitled) return null;
  if (document.uri.scheme !== 'file') return null;

  const filePath = document.uri.fsPath;
  for (const pattern of excludedPatterns()) {
    if (pattern.test(filePath)) return null;
  }

  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const project = folder ? folder.name : path.basename(path.dirname(filePath));
  const relativePath = folder
    ? path.relative(folder.uri.fsPath, filePath).split(path.sep).join('/')
    : path.basename(filePath);

  return {
    project,
    relativePath,
    absolutePath: filePath,
    language: document.languageId,
    branch: currentBranch(folder ? folder.uri.fsPath : null),
  };
}

function enqueue(event) {
  if (!isEnabled()) return;
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    stats.dropped++;
  }
  queue.push(event);
}

function envelope(described, event, extra = {}) {
  return {
    timestamp: new Date().toISOString(),
    source: 'vscode',
    project: described.project,
    file: described.relativePath,
    absolutePath: described.absolutePath,
    language: described.language,
    branch: described.branch,
    event,
    ...extra,
  };
}

function post(events) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ events });
    const request = http.request(
      {
        host: '127.0.0.1',
        port: config().get('port', 47821),
        path: '/events',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 3000,
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300));
      },
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.write(body);
    request.end();
  });
}

async function flush() {
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  const ok = await post(batch);
  if (ok) {
    stats.sent += batch.length;
  } else {
    stats.failed += batch.length;
    queue = batch.concat(queue).slice(-MAX_QUEUE);
  }
  updateStatusBar();
}

let captureConfigRoots = [];
const CAPTURE_CONFIG_INTERVAL_MS = 60_000;
const MAX_SAVE_DIFF_CONTENT_BYTES = 500 * 1024;

function getCaptureConfig() {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: config().get('port', 47821),
        path: '/capture-config',
        method: 'GET',
        timeout: 3000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(Array.isArray(body.roots) ? body.roots : null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

async function refreshCaptureConfig() {
  const roots = await getCaptureConfig();
  if (roots) captureConfigRoots = roots;
}

function captureSaveDiffsFor(absolutePath) {
  if (!absolutePath) return false;
  const normalized = absolutePath.replace(/\\/g, '/').toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const root of captureConfigRoots) {
    if (!root?.path) continue;
    const rootPath = String(root.path).replace(/\\/g, '/').toLowerCase();
    if (normalized === rootPath || normalized.startsWith(rootPath + '/')) {
      if (rootPath.length > bestLen) {
        bestLen = rootPath.length;
        best = root;
      }
    }
  }
  return Boolean(best?.captureSaveDiffs);
}

function updateStatusBar() {
  if (!statusBarItem) return;
  const pending = queue.length;
  const icon = isIdle ? '$(debug-pause)' : '$(record)';
  statusBarItem.text = pending ? `${icon} Narrately ${pending}` : `${icon} Narrately`;
  statusBarItem.tooltip =
    `Narrately collector${isIdle ? ' (idle)' : ''}\n` +
    `Sent: ${stats.sent}  Queued: ${pending}  Edit bursts: ${stats.edits}  Failed: ${stats.failed}` +
    (stats.failed ? '\n\nIs the daemon running? `narrately daemon start`' : '');
}

function recordChange(event) {
  const described = describe(event.document);
  if (!described || !event.contentChanges.length) return;

  markActivity();

  const key = described.absolutePath;
  const entry = pendingEdits.get(key) ?? {
    described,
    linesAdded: 0,
    linesRemoved: 0,
    charsChanged: 0,
  };

  for (const change of event.contentChanges) {
    entry.linesRemoved += change.range.end.line - change.range.start.line;
    entry.linesAdded += (change.text.match(/\n/g) || []).length;
    entry.charsChanged += change.text.length + change.rangeLength;
  }
  entry.described = described;
  pendingEdits.set(key, entry);
}

function emitEditBursts() {
  for (const entry of pendingEdits.values()) {
    if (!entry.linesAdded && !entry.linesRemoved && !entry.charsChanged) continue;
    enqueue(
      envelope(entry.described, 'edit', {
        metrics: {
          linesAdded: entry.linesAdded,
          linesRemoved: entry.linesRemoved,
          charsChanged: entry.charsChanged,
        },
      }),
    );
    stats.edits++;
  }
  pendingEdits.clear();
  updateStatusBar();
}

function markActivity() {
  lastActivityAt = Date.now();
  if (!isIdle) return;

  isIdle = false;
  const idleSec = Math.round((Date.now() - idleStartedAt) / 1000);
  if (currentFocus) {
    enqueue({
      ...envelope(currentFocus, 'idle'),
      duration_sec: idleSec,
    });
    enqueue(envelope(currentFocus, 'editor_focus_start'));
  }
  idleStartedAt = null;
  updateStatusBar();
}

function checkIdle() {
  if (isIdle || !currentFocus) return;
  const since = Date.now() - lastActivityAt;
  if (since < idleThresholdMs()) return;

  emitEditBursts();
  isIdle = true;
  idleStartedAt = lastActivityAt;
  enqueue({
    ...envelope(currentFocus, 'editor_focus_end'),
    timestamp: new Date(lastActivityAt).toISOString(),
  });
  updateStatusBar();
}

function onFocusChange(editor) {
  emitEditBursts();

  if (currentFocus) {
    enqueue(envelope(currentFocus, 'editor_focus_end'));
    currentFocus = null;
  }

  const described = editor ? describe(editor.document) : null;
  if (!described) return;

  currentFocus = described;
  isIdle = false;
  markActivity();
  enqueue(envelope(described, 'editor_focus_start'));
}

function onSave(document) {
  const described = describe(document);
  if (!described) return;
  markActivity();
  enqueue(envelope(described, 'save'));

  if (captureSaveDiffsFor(described.absolutePath)) {
    const content = document.getText();
    if (Buffer.byteLength(content, 'utf8') <= MAX_SAVE_DIFF_CONTENT_BYTES) {
      enqueue(envelope(described, 'save_diff', { content }));
    }
  }
}

function onDiagnosticsChange(event) {
  const active = vscode.window.activeTextEditor;
  if (!active) return;

  for (const uri of event.uris) {
    if (uri.toString() !== active.document.uri.toString()) continue;

    const described = describe(active.document);
    if (!described) return;

    const diagnostics = vscode.languages.getDiagnostics(uri);
    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;

    const key = described.absolutePath;
    const previous = lastErrorCounts.get(key);
    lastErrorCounts.set(key, errors);

    if (previous === undefined || previous === errors) return;

    enqueue(
      envelope(described, 'diagnostics', {
        metrics: { errors, warnings, errorsResolved: Math.max(0, previous - errors) },
      }),
    );
  }
}

function debugDescriptor(session) {
  const folder = session.workspaceFolder;
  return {
    project: folder ? folder.name : 'unknown',
    relativePath: null,
    absolutePath: folder ? folder.uri.fsPath : null,
    language: null,
    branch: currentBranch(folder ? folder.uri.fsPath : null),
  };
}

function reportFileOps(uris, kind) {
  for (const uri of uris.slice(0, 25)) {
    if (uri.scheme !== 'file') continue;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const described = {
      project: folder ? folder.name : path.basename(path.dirname(uri.fsPath)),
      relativePath: folder
        ? path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/')
        : path.basename(uri.fsPath),
      absolutePath: uri.fsPath,
      language: null,
      branch: currentBranch(folder ? folder.uri.fsPath : null),
    };
    for (const pattern of excludedPatterns()) {
      if (pattern.test(uri.fsPath)) return;
    }
    markActivity();
    enqueue(envelope(described, kind));
  }
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'narrately.showStatus';
  updateStatusBar();
  statusBarItem.show();

  context.subscriptions.push(
    statusBarItem,

    vscode.window.onDidChangeActiveTextEditor(onFocusChange),
    vscode.workspace.onDidSaveTextDocument(onSave),
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) onFocusChange(undefined);
      else onFocusChange(vscode.window.activeTextEditor);
    }),

    vscode.workspace.onDidChangeTextDocument(recordChange),
    vscode.window.onDidChangeTextEditorSelection(markActivity),
    vscode.languages.onDidChangeDiagnostics(onDiagnosticsChange),
    vscode.workspace.onDidCreateFiles((event) => reportFileOps([...event.files], 'file_create')),
    vscode.workspace.onDidDeleteFiles((event) => reportFileOps([...event.files], 'file_delete')),
    vscode.workspace.onDidRenameFiles((event) =>
      reportFileOps(event.files.map((file) => file.newUri), 'file_rename'),
    ),
    vscode.debug.onDidStartDebugSession((session) => {
      markActivity();
      enqueue({
        ...envelope(debugDescriptor(session), 'debug_start'),
        label: session.name,
      });
    }),
    vscode.debug.onDidTerminateDebugSession((session) => {
      enqueue({
        ...envelope(debugDescriptor(session), 'debug_end'),
        label: session.name,
      });
    }),

    vscode.commands.registerCommand('narrately.showStatus', () => {
      vscode.window.showInformationMessage(
        `Narrately — sent ${stats.sent}, queued ${queue.length}, edit bursts ${stats.edits}, ` +
          `failed ${stats.failed}.${isIdle ? ' Currently idle.' : ''}`,
      );
    }),
  );

  if (vscode.window.activeTextEditor) onFocusChange(vscode.window.activeTextEditor);

  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  burstTimer = setInterval(emitEditBursts, EDIT_BURST_MS);
  idleTimer = setInterval(checkIdle, IDLE_CHECK_MS);
  refreshCaptureConfig();
  captureConfigTimer = setInterval(refreshCaptureConfig, CAPTURE_CONFIG_INTERVAL_MS);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(flushTimer);
      clearInterval(burstTimer);
      clearInterval(idleTimer);
      clearInterval(captureConfigTimer);
    },
  });
}

async function deactivate() {
  emitEditBursts();
  onFocusChange(undefined);
  clearInterval(flushTimer);
  clearInterval(burstTimer);
  clearInterval(idleTimer);
  clearInterval(captureConfigTimer);
  await flush();
}

module.exports = { activate, deactivate };
