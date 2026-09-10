/** GitHub remotes only; unsupported hosts have no external link. */
export function githubUrl(remote: string): string | null {
  const stripped = stripRemote(remote, /^https?:\/\//);
  const path = /^[^/.]+\/[^/]+$/.test(stripped) ? `github.com/${stripped}` : stripped;
  return /^github\.com\/[^/]+\/[^/]+$/.test(path) ? `https://${path}` : null;
}
/** Compare repository spellings, including setup's GitHub org/repo shorthand. */
export function repoIdentity(remote: string): string {
  const path = stripRemote(remote.trim(), /^[a-z][a-z0-9+.-]*:\/\//).toLowerCase();
  return /^[^/.]+\/[^/]+$/.test(path) ? `github.com/${path}` : path;
}
/** Abbreviate a known absolute home only at the beginning of a complete path token. */
export function abbreviateHome(text: string, home: string): string {
  const prefix = home.replace(/[\\/]+$/, '');
  if (!prefix || !/^(?:\/|[A-Za-z]:[\\/])/.test(prefix)) return text;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp('(^|[\\s"\'`(=:\\[])' + escaped + '(?=$|[\\\\/\\s"\'`),;:\\]\\}])', 'g'), '$1~');
}

export function stripRemote(remote: string, protocol: RegExp = /^[a-z][a-z0-9+.-]*:\/\//): string {
  return remote.replace(/^git@github\.com:/, 'github.com/').replace(/^ssh:\/\/git@/, '').replace(protocol, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
}
