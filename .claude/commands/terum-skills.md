Invoke the `terum-skills` skill to run one terum-skills CLI verb from inside the session
(`npx -y terum-skills@latest <verb> …`), or to prepare and hand over the verbs that need a
terminal because they ask a question. Pass through any arguments: $ARGUMENTS

`$ARGUMENTS` may be empty (the skill asks which verb, default `status`), a verb with its
arguments (`ls --local`, `validate /abs/path`, `publish my-skill`, `eval my-skill --triggers-only`),
or a hand-off verb (`share /abs/path`, `setup`) that the skill prepares for a terminal.
