import { detailOf, design } from './data';

/**
 * A construct-complete Markdown document for the test-only `?__mock=raw-md` scenario. It exists so the
 * real render path (SkillMarkdown) is reachable from a browser, which is the only place a computed style
 * can be asserted — `vitest.config.ts` sets `css:false`. It is NOT fixture content for any board: no
 * FIDELITY row may ever use `raw-md`, and `readScenario` returns 'default' inside the native shell.
 */
export const RAW_MD = `${detailOf(design.DETAIL).skillMd.frontmatter}

## When to use

Before any deploy that touches migrations, with \`--dry-run\` first and a **rollback note** ready.

---

### Steps

1. Read the project config and the example env file.
2. List the migrations added on this branch.
   - Each needs a number.
   - Each needs a rollback note.
3. Diff the env vars the code reads against what is pinned.

#### Notes

- [ ] not done yet
- [x] done

> A quoted aside about the <slug> placeholder, which must render literally.

| Check | Result |
| --- | ---: |
| migrations | 3 |
| env vars | 12 |

\`\`\`bash
npx -y terum-skills@latest validate deploy-check
\`\`\`

See [the docs](https://example.com/docs) and https://example.com/bare and ![a screenshot](https://example.com/shot.png).
`;
