import { expect, it } from 'vitest';
import { abbreviateHome } from '../paths';

it.each([
  ["Invalid /Users/teddy/.terum/skills/config.json", '/Users/teddy', 'Invalid ~/.terum/skills/config.json'],
  ["open '/home/teddy/skills/a'", '/home/teddy/', "open '~/skills/a'"],
  [String.raw`Invalid C:\Users\Teddy Liu\.terum\skills\config.json`, String.raw`C:\Users\Teddy Liu`, String.raw`Invalid ~\.terum\skills\config.json`],
  ['/tmp/Users/teddy/skills /Users/teddy-other/skills', '/Users/teddy', '/tmp/Users/teddy/skills /Users/teddy-other/skills'],
  ['/Users/teddy/skills', '', '/Users/teddy/skills'],
  ["'/Users/teddy' (/Users/teddy/a) /Users/teddy/b", '/Users/teddy', "'~' (~/a) ~/b"],
  ['/home/a.b/x /home/axb/x', '/home/a.b', '~/x /home/axb/x'],
  ['/home/a/x', '/', '/home/a/x'],
])('abbreviates only known home path tokens: %s', (text, home, expected) => {
  expect(abbreviateHome(text, home)).toBe(expected);
});
