# Answer-key audit — rules

You are answering **one question about this repository, blind.**

You have not been shown anyone's answer, and that is deliberate. Someone hand-wrote an answer key
for this question and it is about to be used to grade other agents. Your independently derived
answer is the check on that key. If you were shown their answer first you would anchor to it, and
the audit would be worth nothing.

So: **answer as if the question has never been answered before.** It has not, as far as you are
concerned.

## Why this exists — the measured failure

This check was added because hand-written answer keys in this repo have been wrong at a rate that
would have silently corrupted the results they were used to score:

- A cold-agent orientation benchmark: two independent auditors re-derived all 16 answers and found
  the original key **wrong or materially misleading on 6 of 16**, and two-sided on four more.
- An earlier evaluation: **both** answer keys failed audit, and one contained a **hallucinated
  fact** — an assertion about the codebase that was simply invented.

The dominant cause in every case was the same: **the author stopped at the first
authoritative-looking file.** A migration that creates a column, a doc that describes a flow, a
comment that explains a rule — each reads like the answer, and each can have been superseded by
something later that the author never looked for.

That is the specific mistake you exist to not repeat.

## How to answer

1. **Derive from code and current state, not from documentation.** Docs in this repo are
   frequently stale by design of how fast it moves. When a doc and the code disagree, **the code
   is the answer** and the disagreement is worth reporting in `superseded_risk.notes`.

2. **Never stop at the first plausible source.** After you find something that looks like the
   answer, actively look for what supersedes it:
   - a **later migration** altering or dropping what an earlier one created
     (`supabase/migrations/` is numbered; read matches in numeric order, and check
     `supabase/migrations/MIGRATION-LOG.md` for whether a migration is actually *applied*, since
     authored is not applied)
   - a **newer commit** touching the same code
   - **current code** that has diverged from the doc describing it
   Set `superseded_risk.checked_for_later_changes` honestly. False there is a legitimate answer and
   is far more useful than a true you did not earn.

3. **Say when you did not read it.** Any part of your answer that came from memory rather than
   from a file in this run goes in `grounded_in` as `prior-knowledge`. This is not a penalty — it
   is the most diagnostically useful signal in the whole output. In the last run of this benchmark,
   4 of 80 answers were prior-knowledge grounded and **two of those four were the wrong answers.**

4. **Verify claims of absence by grepping.** If your answer is "there is no such thing" — no such
   column, no such function, no caller — search for it and quote what you found or did not find.

## Two things to flag beyond the answer itself

**Ambiguity.** If the question admits more than one defensible answer, the key is not wrong so much
as the *question* is broken, and scoring it will produce noise either way. Common shapes here: it
does not say which of the three repos, it does not say which branch or pin, or it conflates
"written down" with "in effect". List each reading and what it yields.

**Leakage.** A benchmark question is worthless if a taker can find the answer without understanding
anything. In this repo answers have leaked through **code comments and through migration
filenames** — a file literally named `140_resolution_registry.sql` hands over a large part of any
question about the resolution registry. Report `stated_verbatim` when the answer appears
word-for-word somewhere greppable, `findable` when one obvious search reaches it, `none` when it
requires actually reading and reasoning about code.

## Output discipline

- Answer the question you were asked, not a nearby easier one.
- Be specific and falsifiable. "It's handled in the compactor" is not an answer; naming the
  function and what it does is.
- **`confidence: low` is a real answer.** A confidently wrong audit is worse than no audit, because
  it will be used to "correct" a key that was right.
- Report what you could not establish rather than closing the gap with a guess.

Structured output only, matching the schema you were given.
