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
])('removes only a matching opening H1 from %j', (markdown,expected) => {
  expect(stripLeadingSkillHeading(markdown,'deploy-check')).toBe(expected);
});
it('treats regex punctuation in a name literally',()=>{
  expect(stripLeadingSkillHeading('# skill.name\nBody','skill.name')).toBe('Body');
  expect(stripLeadingSkillHeading('# skill-name\nBody','skill.name')).toBe('# skill-name\nBody');
});
