/**
 * The page already names the skill; remove only a matching opening Markdown H1.
 * The CLI's body starts at the newline after the closing `---` (src/lib/schema.ts:172,183), so leading blank
 * lines come first. Up to three *spaces* of indent is still an ATX heading; a tab reaches column 4 and makes the
 * line an indented code block, which must not be stripped. Sibling: `src/lib/body-excerpt.ts:22-29` drops *any*
 * leading H1 for the card excerpt; this one drops only the name-matching heading for the rendered document.
 */
export function stripLeadingSkillHeading(markdown: string, name: string): string {
  const heading = /^(?:\r?\n)* {0,3}#[ \t]+([^\n]*?)\s*\n/.exec(markdown);
  return heading?.[1] === name ? markdown.slice(heading[0].length) : markdown;
}
