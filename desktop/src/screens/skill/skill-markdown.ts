/** The page already names the skill; remove only a matching opening Markdown H1. */
export function stripLeadingSkillHeading(markdown: string, name: string): string {
  const heading = /^#\s+([^\n]*?)\s*\n/.exec(markdown);
  return heading?.[1] === name ? markdown.slice(heading[0].length) : markdown;
}
