#!/usr/bin/env bash
# Generate adversarial test inputs from a CONTRACT, by a model that cannot see the implementation.
#
# WHY: `.claude/skills/codex-implement/SKILL.md` (step 3, "Adversarial test inputs") requires tests
# built from "inputs the implementation has never seen — if a regex or lookup table could pass all
# your tests, the tests are too weak." That is structurally unsatisfiable by whoever wrote the code:
# their cases come from the same mental model that produced it, so they land on branches the code
# already handles. The same holds for whoever wrote a FIX — a test written minutes after the fix, by
# the fixer, asserts the fix's mechanism, not the failure. A model working from the contract alone
# can fail.
#
# HOW THE BLINDNESS IS ENFORCED: the contract files are COPIED into a scratch directory and Codex
# is rooted there (`-C <scratch> --skip-git-repo-check`). The repository is not reachable from
# inside that root, so reading the implementation is impossible rather than discouraged. Structure,
# not a promise in a prompt — the same principle as the rest of `.claude/codex/`.
#
#   bash scripts/codex-adversarial-tests.sh --target "normalizeRemote" contract.md
#   bash scripts/codex-adversarial-tests.sh --target "..." contract.md types.d.ts --model=terra
#
# A CONTRACT FILE IS NOT A SOURCE FILE. Passing the implementation defeats the entire tool. Write
# the contract down yourself — docstring, signature, types, invariants, no function bodies. If you
# cannot state the contract without the code in front of you, THAT is the finding: stop and fix the
# contract before writing any test.
#
# Ported 2026-09-04 from conflict-detection/MVP/scripts/codex-adversarial-tests.sh. The rules and
# schema it reads (`.claude/codex/rules/adversarial-tests.md`, `.claude/codex/schemas/adversarial-
# tests.json`) were already tracked here, byte-identical to the MVP copies. One addition over the
# MVP script: the raw JSON is kept at `.planning/audits/codex/adversarial-<target>.json` (override
# with `--out=<path>`), because the skill says the cases land there and a printed transcript alone
# is gone by the time the fold-in starts.
#
# Read-only. Touches no database. Exits 0 if cases were produced, 1 otherwise.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

TARGET=""
MODEL="gpt-5.6-sol"
EFFORT="high"
OUT_FILE=""
CONTRACTS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --target)   TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --model=sol)   MODEL="gpt-5.6-sol";   shift ;;
    --model=terra) MODEL="gpt-5.6-terra"; shift ;;
    --model=luna)  MODEL="gpt-5.6-luna";  shift ;;
    --effort=*) EFFORT="${1#*=}"; shift ;;
    --out=*)    OUT_FILE="${1#*=}"; shift ;;
    -*)         echo "unknown option: $1" >&2; exit 1 ;;
    *)          CONTRACTS+=("$1"); shift ;;
  esac
done

if [ -z "$TARGET" ] || [ ${#CONTRACTS[@]} -eq 0 ]; then
  echo "usage: bash scripts/codex-adversarial-tests.sh --target \"<function under test>\" <contract-file>... [--model=sol|terra|luna] [--effort=<level>] [--out=<json-path>]" >&2
  exit 1
fi

for f in "${CONTRACTS[@]}"; do
  [ -f "$f" ] || { echo "no such contract file: $f" >&2; exit 1; }
done

if [ -z "$OUT_FILE" ]; then
  SLUG="$(printf '%s' "$TARGET" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//; s/-*$//')"
  OUT_FILE=".planning/audits/codex/adversarial-${SLUG:-target}.json"
fi

RULES=".claude/codex/rules/adversarial-tests.md"
SCHEMA=".claude/codex/schemas/adversarial-tests.json"
# NOTE: preamble.md is deliberately NOT included. It orients a reader inside this repository, and
# this run must not know it is in this repository at all — that is the whole isolation.
for f in "$RULES" "$SCHEMA"; do
  [ -f "$f" ] || { echo "missing required file: $f" >&2; exit 1; }
done

command -v codex >/dev/null 2>&1 || { echo "codex CLI not found on PATH." >&2; exit 1; }
if codex login status 2>&1 | grep -qi "not logged in"; then
  echo "codex is not logged in. Run 'codex login' yourself — it opens a browser." >&2
  exit 1
fi

SANDBOX="$(mktemp -d)"
OUT="$(mktemp)"
PROMPT="$(mktemp)"
trap 'rm -rf "$SANDBOX" "$OUT" "$PROMPT"' EXIT

# The sandbox gets copies of the contract and nothing else. Codex is rooted here, so the repo —
# including the implementation — is outside anything it can read.
for f in "${CONTRACTS[@]}"; do cp "$f" "$SANDBOX/$(basename "$f")"; done

{
  cat "$RULES"
  printf '\n\n---\n\n## The function under test\n\n`%s`\n\n' "$TARGET"
  printf 'Its contract is below, and is reproduced in full in your working directory. There is no\n'
  printf 'implementation anywhere you can reach — that is intentional, not an oversight. Do not go\n'
  printf 'looking for one, and do not ask for it.\n\n'
  for f in "${CONTRACTS[@]}"; do
    printf '### %s\n\n```\n' "$(basename "$f")"
    cat "$f"
    printf '\n```\n\n'
  done
} > "$PROMPT"

echo "generating adversarial inputs for '$TARGET' with $MODEL (effort=$EFFORT)" >&2
echo "sandbox root: $SANDBOX  (contract only — repo not reachable)" >&2

codex exec - \
  -C "$SANDBOX" \
  -s read-only \
  --ephemeral \
  --ignore-user-config \
  --skip-git-repo-check \
  -m "$MODEL" \
  -c "model_reasoning_effort=$EFFORT" \
  --output-schema "$SCHEMA" \
  -o "$OUT" \
  < "$PROMPT" >/dev/null 2>&1
RC=$?

# Exit codes are unreliable in both directions; the emitted JSON is the only evidence a run happened.
if [ ! -s "$OUT" ]; then
  echo "" >&2
  echo "GENERATION DID NOT RUN (codex exit $RC, no output)." >&2
  echo "That is an absent result, not 'no adversarial cases exist'." >&2
  exit 1
fi

# Keep the raw JSON before the EXIT trap removes the temp copy; the fold-in reads this file.
mkdir -p "$(dirname "$OUT_FILE")" && cp "$OUT" "$OUT_FILE" || { echo "could not save raw JSON to $OUT_FILE" >&2; }

node - "$OUT" "$TARGET" "$OUT_FILE" <<'NODE'
const fs = require("fs");
const [, , outPath, target, savedPath] = process.argv;
let r;
try { r = JSON.parse(fs.readFileSync(outPath, "utf8")); }
catch (e) { console.error(`unparseable output: ${e.message}`); process.exit(1); }

const line = "─".repeat(76);
const wrap = (s, ind) => String(s ?? "").replace(/\s+/g, " ").trim()
  .replace(new RegExp(`(.{1,${76 - ind.length}})(\\s|$)`, "g"), `${ind}$1\n`).trimEnd();

console.log(line);
console.log(`ADVERSARIAL INPUTS — ${target}`);
console.log(line);
console.log("\nWHAT CODEX THINKS THIS DOES (from the contract alone):");
console.log(wrap(r.understanding, "  "));
console.log("\n  ^ If that is wrong, STOP. The contract is unclear, and every case below inherits");
console.log("    the misunderstanding. Fix the contract first.");

const cases = r.cases ?? [];
console.log(`\n${line}\nCASES (${cases.length})\n${line}`);
for (const c of cases) {
  console.log(`\n▸ ${c.name}   [${c.category}]`);
  console.log(`  input:    ${String(c.inputs ?? "").replace(/\s+/g, " ").trim()}`);
  console.log(wrap(`expected: ${c.expected}`, "  "));
  console.log(wrap(`kills:    ${c.defeats}`, "  "));
  console.log(wrap(`why:      ${c.why_adversarial}`, "  "));
}

const gaps = r.contract_gaps ?? [];
if (gaps.length) {
  console.log(`\n${line}\nCONTRACT GAPS (${gaps.length}) — the contract does NOT decide these\n${line}`);
  for (const g of gaps) {
    console.log(`\n▸ ${String(g.gap).replace(/\s+/g, " ").trim()}`);
    console.log(wrap(`matters: ${g.why_it_matters}`, "  "));
  }
}

const asm = r.assumptions ?? [];
if (asm.length) {
  console.log(`\n${line}\nASSUMPTIONS — each is a place the EXPECTED value may be wrong, not the code\n${line}`);
  for (const a of asm) console.log(wrap(`• ${a}`, "  "));
}

console.log(`\n${line}`);
console.log("These are candidate inputs, not verdicts. Run them against the real implementation:");
console.log("a failure is either a bug OR a wrong expectation — the contract gaps above are where");
console.log("the second is most likely. Codex never saw the implementation, by construction.");
console.log(`Raw JSON kept at: ${savedPath}`);
console.log(line);
process.exit(cases.length > 0 ? 0 : 1);
NODE
