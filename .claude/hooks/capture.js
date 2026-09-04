// Terum capture hook shim (Stop + UserPromptSubmit).
//
// Why this exists: the capture hooks used to live in Ryan's user-global settings.json with a
// hardcoded `C:/Users/Ryan Liu/pipx/venvs/terum-capture/Scripts/python.exe`. Harness assets are
// repo-level now so teammates inherit them (see .claude/skills/README.md), and an absolute
// per-machine path cannot go in a tracked file. This resolves the interpreter at run time.
//
// Fail-open by construction: a teammate without terum-capture installed gets a silent no-op, never
// a failing hook on every Stop. Capture is best-effort telemetry — it must never block a session.
//
// Usage (from .claude/settings.json):
//   node "$CLAUDE_PROJECT_DIR/.claude/hooks/capture.js" upload
//   node "$CLAUDE_PROJECT_DIR/.claude/hooks/capture.js" delivery-hook prompt
//
// Override the interpreter with TERUM_CAPTURE_PYTHON if your install lives elsewhere.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (!args.length) process.exit(0);

// Invoke the venv's python with `-m terum_capture`, never the pipx .exe shim: Windows Smart App
// Control blocks unsigned shims on reputation, and the module form sidesteps it entirely.
function resolvePython() {
  const home = os.homedir();
  const candidates = [
    // Explicit override wins, but only if it actually exists — a typo'd override must fall
    // back to auto-detection rather than silently disabling capture forever.
    process.env.TERUM_CAPTURE_PYTHON,
    path.join(home, 'pipx', 'venvs', 'terum-capture', 'Scripts', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'pipx', 'pipx', 'venvs', 'terum-capture', 'Scripts', 'python.exe'),
    path.join(home, '.local', 'pipx', 'venvs', 'terum-capture', 'bin', 'python'),
    path.join(home, '.local', 'share', 'pipx', 'venvs', 'terum-capture', 'bin', 'python'),
    path.join(home, '.local', 'share', 'uv', 'tools', 'terum-capture', 'bin', 'python'),
  ];
  for (const c of candidates) {
    if (!c) continue;
    try { if (fs.statSync(c).isFile()) return c; } catch { /* next candidate */ }
  }
  return null;
}

const python = resolvePython();
if (!python) process.exit(0); // terum-capture not installed on this machine

// stdio: 'inherit' passes the hook's stdin JSON through and lets delivery-hook write its
// additionalContext straight to stdout.
spawnSync(python, ['-m', 'terum_capture', ...args], { stdio: 'inherit' });

process.exit(0); // capture never fails a session, whatever the CLI returned
