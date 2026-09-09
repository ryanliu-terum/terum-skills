/** GitHub remotes only; unsupported hosts have no external link. */
export function githubUrl(remote: string): string | null {
  const path = remote.replace(/^git@github\.com:/, 'github.com/').replace(/^ssh:\/\/git@/, '').replace(/^https?:\/\//, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
  return /^github\.com\/[^/]+\/[^/]+$/.test(path) ? `https://${path}` : null;
}
/** Abbreviate a known absolute home only at the beginning of a complete path token. */
export function abbreviateHome(text: string, home: string): string {
  const prefix = home.replace(/[\\/]+$/, '');
  if (!prefix || !/^(?:\/|[A-Za-z]:[\\/])/.test(prefix)) return text;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp('(^|[\\s"\'`(=:\\[])' + escaped + '(?=$|[\\\\/\\s"\'`),;:\\]\\}])', 'g'), '$1~');
}
