/** The referrer allowlist, shared by the browser SDK (build-sdk.mjs inlines this file) and the collector
 * (stat-contract.mjs imports it), so the two cannot drift (CommitAtlas#247).
 *
 * A referrer host can carry a person's name (jane.github.io, janedoe.com), and it travels in the default-on
 * counts lane under a bar that says "no names". Only registrable platform domains from this fixed list are
 * therefore ever sent or stored; subdomains collapse to the platform, and everything else becomes `other`.
 * Each entry: [canonical domain, source category, host suffixes that map to it]. A suffix matches the host
 * itself or any subdomain of it. The two patterns cover country domains (google.co.uk, yandex.ru). */
const TABLE = [
  ['google.com', 'search', [], /(?:^|\.)google\.[a-z]{2,3}(?:\.[a-z]{2})?$/],
  ['bing.com', 'search', ['bing.com']],
  ['duckduckgo.com', 'search', ['duckduckgo.com']],
  ['yahoo.com', 'search', ['yahoo.com']],
  ['ecosia.org', 'search', ['ecosia.org']],
  ['brave.com', 'search', ['brave.com']],
  ['yandex.com', 'search', [], /(?:^|\.)yandex\.[a-z]{2,3}(?:\.[a-z]{2})?$/],
  ['baidu.com', 'search', ['baidu.com']],
  ['x.com', 'social', ['x.com', 'twitter.com', 't.co']],
  ['facebook.com', 'social', ['facebook.com']],
  ['instagram.com', 'social', ['instagram.com']],
  ['linkedin.com', 'social', ['linkedin.com', 'lnkd.in']],
  ['reddit.com', 'social', ['reddit.com']],
  ['news.ycombinator.com', 'social', ['news.ycombinator.com']],
  ['lobste.rs', 'social', ['lobste.rs']],
  ['mastodon.social', 'social', ['mastodon.social']],
  ['bsky.app', 'social', ['bsky.app']],
  ['youtube.com', 'social', ['youtube.com', 'youtu.be']],
  ['tiktok.com', 'social', ['tiktok.com']],
  ['discord.com', 'social', ['discord.com', 'discord.gg']],
  ['slack.com', 'social', ['slack.com']],
  ['medium.com', 'social', ['medium.com']],
  ['dev.to', 'social', ['dev.to']],
  ['producthunt.com', 'social', ['producthunt.com']],
  ['github.com', 'github', ['github.com']],
  ['github.io', 'github', ['github.io']],
  ['gitlab.com', 'other', ['gitlab.com']],
  ['stackoverflow.com', 'other', ['stackoverflow.com']],
];

/** Every value `referrerDomain` can return, besides null. */
export const REFERRER_DOMAINS = Object.freeze(TABLE.map(([domain]) => domain));

function lookup(host) {
  if (typeof host !== 'string') return null;
  let value = host.toLowerCase().replace(/\.$/, '');
  if (value.startsWith('www.')) value = value.slice(4);
  if (!/^[a-z0-9.-]{1,253}$/.test(value)) return null;
  for (const [domain, source, suffixes, pattern] of TABLE) {
    if (suffixes.some(suffix => value === suffix || value.endsWith('.' + suffix)) || pattern?.test(value)) return { domain, source };
  }
  return null;
}

/** The canonical platform domain for a host, or null when it is not on the list. */
export function referrerDomain(host) {
  return lookup(host)?.domain ?? null;
}

/** The referral source category for a host on the list (`search`, `social`, `github`, `other`), or null. */
export function referrerSource(host) {
  return lookup(host)?.source ?? null;
}
