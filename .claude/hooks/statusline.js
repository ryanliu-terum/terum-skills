#!/usr/bin/env node
// Portable cross-platform statusline (Node only — no jq/bash, works on Windows & macOS).
// Reproduces the macOS bash statusline:  model │ branch +staged ~mod ?untracked │ cwd  [ctx bar %]
const { execFileSync } = require("child_process");
const os = require("os");

// Timeout guard: if stdin never closes (pipe quirks on Windows/Git Bash), exit silently.
const killer = setTimeout(() => process.exit(0), 3000);

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  clearTimeout(killer);
  try {
    render(JSON.parse(input));
  } catch {
    /* malformed input — show nothing rather than crash */
  }
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function render(data) {
  const E = "\x1b[";
  const dim = (s) => `${E}2m${s}${E}0m`;

  const cwd = data.cwd || (data.workspace && data.workspace.current_dir) || "";
  const home = os.homedir();
  let shortCwd = cwd;
  if (home && cwd.startsWith(home)) shortCwd = "~" + cwd.slice(home.length);

  // --- git branch + dirty breakdown (omitted gracefully if git is missing / not a repo) ---
  let branchSeg = "";
  if (cwd) {
    try {
      const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
      if (branch) {
        let dirty = "";
        const status = git(cwd, ["status", "--porcelain"]);
        if (status.trim()) {
          let staged = 0,
            modified = 0,
            untracked = 0;
          for (const line of status.split("\n")) {
            if (!line) continue;
            const x = line[0],
              y = line[1];
            if (x === "?") untracked++;
            else {
              if (x !== " " && x !== "!") staged++;
              if (y === "M" || y === "D") modified++;
            }
          }
          if (staged) dirty += ` ${E}32m+${staged}${E}0m`;
          if (modified) dirty += ` ${E}33m~${modified}${E}0m`;
          if (untracked) dirty += ` ${E}2m?${untracked}${E}0m`;
        }
        branchSeg = ` │ ${E}36m${branch}${E}0m${dirty}`;
      }
    } catch {
      /* git not on PATH or not a repo */
    }
  }

  // --- context window bar (Claude reserves ~16.5% for autocompact; normalize to usable range) ---
  let ctx = "";
  const remaining = data.context_window && data.context_window.remaining_percentage;
  if (remaining != null) {
    const buf = 16.5;
    let usable = ((remaining - buf) / (100 - buf)) * 100;
    if (usable < 0) usable = 0;
    const used = Math.round(Math.max(0, Math.min(100, 100 - usable)));
    const filled = Math.floor(used / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    let color;
    if (used < 50) color = "32m";
    else if (used < 65) color = "33m";
    else if (used < 80) color = "38;5;208m";
    else color = "5;31m";
    const skull = used >= 80 ? "💀 " : "";
    ctx = ` │ ${E}${color}${skull}${bar} ${String(used).padStart(3)}%${E}0m`;
  }

  // --- weekly (7-day) quota usage ---
  let weekly = "";
  const weeklyPct = data.rate_limits && data.rate_limits.seven_day && data.rate_limits.seven_day.used_percentage;
  if (weeklyPct != null) {
    const used = Math.round(Math.max(0, Math.min(100, weeklyPct)));
    const filled = Math.floor(used / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    let color;
    if (used < 50) color = "32m";
    else if (used < 70) color = "33m";
    else if (used < 85) color = "38;5;208m";
    else color = "5;31m";
    const skull = used >= 85 ? "💀 " : "";
    weekly = ` │ ${E}${color}${skull}${bar} ${String(used).padStart(3)}%${E}0m`;
  }

  const model = (data.model && data.model.display_name) || "Claude";
  process.stdout.write(dim(model) + ctx + weekly + branchSeg + " │ " + dim(shortCwd));
}
