import { expect, it } from 'vitest';
import { abbreviateHome, repoIdentity, githubUrl } from '../paths';

it.each([
  ["Invalid /Users/teddy/.terum/skills/config.json", '/Users/teddy', 'Invalid ~/.terum/skills/config.json'],
  ["open '/home/teddy/skills/a'", '/home/teddy/', "open '~/skills/a'"],
  [String.raw`Invalid C:\Users\Teddy Liu\.terum\skills\config.json`, String.raw`C:\Users\Teddy Liu`, String.raw`Invalid ~\.terum\skills\config.json`],
  ['/tmp/Users/teddy/skills /Users/teddy-other/skills', '/Users/teddy', '/tmp/Users/teddy/skills /Users/teddy-other/skills'],
  ['/Users/teddy/skills', '', '/Users/teddy/skills'],
  ["'/Users/teddy' (/Users/teddy/a) /Users/teddy/b", '/Users/teddy', "'~' (~/a) ~/b"],
  ['/home/a.b/x /home/axb/x', '/home/a.b', '~/x /home/axb/x'],
  ['/home/a/x', '/', '/home/a/x'],
  [String.raw`\\wsl.localhost\Ubuntu\home\teniroo`, String.raw`C:\Users\teddy`, String.raw`\\wsl.localhost\Ubuntu\home\teniroo`],
  [String.raw`\\wsl.localhost\Ubuntu\home\teniroo\.claude\skills`, String.raw`\\wsl.localhost\Ubuntu\home\teniroo`, String.raw`\\wsl.localhost\Ubuntu\home\teniroo\.claude\skills`],
  [String.raw`open '\\wsl.localhost\Ubuntu\home\teniroo\a'`, String.raw`C:\Users\teniroo`, String.raw`open '\\wsl.localhost\Ubuntu\home\teniroo\a'`],
])('abbreviates only known home path tokens: %s', (text, home, expected) => {
  expect(abbreviateHome(text, home)).toBe(expected);
});

it.each([
 ['https://github.com/Acme/Team.git','github.com/acme/team'],
 ['git@github.com:acme/team.git','github.com/acme/team'],
 ['github.com/acme/team/','github.com/acme/team'], ['acme/team','github.com/acme/team'],
 [' ssh://git@github.com/Acme/Team.git/ ','github.com/acme/team'],
 ['/srv/x/team.git','/srv/x/team'], ['file:///srv/x/team.git','/srv/x/team'],
])('normalizes repository identity: %s',(remote,expected)=>{expect(repoIdentity(remote)).toBe(expected);});

it.each(['acme/team', 'acme/team.git'])('links owner/repo shorthand %s', remote => {
  expect(githubUrl(remote)).toBe('https://github.com/acme/team');
});
it.each(['gitlab.com/acme/team', '/srv/team', 'not a remote'])('does not link unsupported repository %s', remote => {
  expect(githubUrl(remote)).toBeNull();
});
