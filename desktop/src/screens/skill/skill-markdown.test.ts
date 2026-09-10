import { expect,it } from 'vitest';
import { stripLeadingSkillHeading } from './skill-markdown';

it.each([
  ['# deploy-check\n\nBody','Body'],
  ['# deploy-check   \nBody','Body'],
  ['# other\nBody','# other\nBody'],
  ['# Deploy-check\nBody','# Deploy-check\nBody'],
  ['Intro\n# deploy-check\nBody','Intro\n# deploy-check\nBody'],
  ['# deploy-check\n# deploy-check\nBody','# deploy-check\nBody'],
  ['## deploy-check\nBody','## deploy-check\nBody'],
  ['\n# deploy-check\n\nBody','Body'],                       // the real CLI wire shape — fails on main
  ['\n\n  # deploy-check\nBody','Body'],                     // blank lines then 2-space indent
  ['   # deploy-check\nBody','Body'],                        // 3-space indent is still an ATX heading
  ['    # deploy-check\nBody','    # deploy-check\nBody'],    // 4 spaces is an indented code block
  ['\t# deploy-check\nBody','\t# deploy-check\nBody'],        // a tab reaches column 4 — also a code block
  ['\r\n# deploy-check\r\nBody','Body'],                     // CRLF
  ['\r\n# deploy-check\r\n\r\nBody','Body'],                 // CRLF with a blank line after the heading
  ['# deploy-check\t\nBody','Body'],                         // trailing tab
  ['\nIntro\n# deploy-check\n','\nIntro\n# deploy-check\n'],  // not the FIRST line: never strip
  ['# deploy-check','# deploy-check'],                       // heading at EOF, no newline: never strip (D11)
  ['#\ndeploy-check\nBody','#\ndeploy-check\nBody'],          // `#` alone is not `# name` (D10, `\s`→`[ \t]`)
  ['#deploy-check\nBody','#deploy-check\nBody'],              // no space after # is not an ATX heading
  ['# deploy-check #\nBody','# deploy-check #\nBody'],        // a closing sequence is not an exact name match
  ['\n\n\n','\n\n\n'],                                       // blank lines only
  ['',''],                                                    // empty body
])('removes only a matching opening H1 from %j', (markdown,expected) => {
  expect(stripLeadingSkillHeading(markdown,'deploy-check')).toBe(expected);
});
it('treats regex punctuation in a name literally',()=>{
  expect(stripLeadingSkillHeading('# skill.name\nBody','skill.name')).toBe('Body');
  expect(stripLeadingSkillHeading('# skill-name\nBody','skill.name')).toBe('# skill-name\nBody');
});
it('leaves an indented heading alone because it is a code block, not a title',()=>{
  expect(stripLeadingSkillHeading('    # deploy-check\nBody','deploy-check')).toBe('    # deploy-check\nBody');
  expect(stripLeadingSkillHeading('\t# deploy-check\nBody','deploy-check')).toBe('\t# deploy-check\nBody');
});
