#!/usr/bin/env node
// PostToolUse[Read]: reading a handoff file == resuming (consuming) it.
// Stamp a `> RESUMED <ts>` marker so the next /handoff writer knows the default
// slot is free. Idempotent; no-ops on every non-handoff read. The Step-0 ownership
// peek must use grep/Bash (NOT the Read tool) so it doesn't trip this.
const fs = require("fs");

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
if (payload.tool_name !== "Read") process.exit(0);

const filePath = payload.tool_input && payload.tool_input.file_path;
if (!filePath) process.exit(0);

const norm = filePath.replace(/\\/g, "/");
if (!/\.claude\/handoff[-a-z0-9]*\.md$/i.test(norm)) process.exit(0);

let body;
try { body = fs.readFileSync(filePath, "utf8"); } catch { process.exit(0); }
if (/^>\s*RESUMED\b/m.test(body)) process.exit(0); // already consumed — idempotent

const ts = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const marker = `> RESUMED ${ts} — picked up by an active session; safe to overwrite.`;
const out = /^#\s+Handoff[^\n]*$/m.test(body)
  ? body.replace(/^(#\s+Handoff[^\n]*)$/m, `$1\n\n${marker}`)
  : `${marker}\n\n${body}`;

try { fs.writeFileSync(filePath, out); } catch { process.exit(0); }
console.log(`[handoff] stamped RESUMED on ${norm} — default slot freed for the next /handoff.`);
