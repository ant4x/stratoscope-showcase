// Excerpt from Stratoscope: src/lib/scan/robots.ts (full file). Source is private.
export type Rule = { allow: boolean; pattern: string }
export type Group = { agents: string[]; rules: Rule[] }
export type Robots = { groups: Group[]; sitemaps: string[] }

/** Google reads only the first 500 KiB of robots.txt. */
const MAX_BYTES = 500 * 1024

/** Parses robots.txt by RFC 9309: consecutive user-agent lines share one group, sitemap lines belong to no group. */
export function parseRobots(body: Buffer): Robots {
  const robots: Robots = { groups: [], sitemaps: [] }
  let group: Group | null = null
  let readingAgents = false

  const text = body.subarray(0, MAX_BYTES).toString('utf8')
  for (const line of text.split(/\r\n|\r|\n/)) {
    const content = line.split('#')[0]
    const colon = content.indexOf(':')
    if (colon < 0) continue
    const key = content.slice(0, colon).trim().toLowerCase()
    const value = content.slice(colon + 1).trim()

    if (key === 'user-agent') {
      if (!group || !readingAgents) robots.groups.push(group = { agents: [], rules: [] })
      group.agents.push(agentToken(value))
      readingAgents = true
    } else if (key === 'allow' || key === 'disallow') {
      readingAgents = false
      if (group && value) group.rules.push({ allow: key === 'allow', pattern: normalize(value) })
    } else if (key === 'sitemap' && value) {
      robots.sitemaps.push(value)
    }
  }
  return robots
}

/**
 * Whether a crawler may fetch `url`. `agents` are its product tokens in order of precedence, such as "googlebot",
 * or ["applebot", "googlebot"] for a crawler that follows Googlebot's rules when it has none of its own.
 * The longest matching pattern wins; on a tie, allow wins.
 */
export function isAllowed(robots: Robots, agents: string | string[], url: string): boolean {
  const { pathname, search } = new URL(url)
  if (pathname === '/robots.txt') return true
  const path = normalize(pathname + search)

  let best: Rule | null = null
  for (const rule of rulesFor(robots, [agents].flat())) {
    if (!matches(rule.pattern, path)) continue
    const longer = !best || rule.pattern.length > best.pattern.length
    const tieToAllow = best && rule.pattern.length === best.pattern.length && rule.allow
    if (longer || tieToAllow) best = rule
  }
  return best?.allow ?? true
}

/** The token whose groups apply to a crawler: the first of `agents` with a group, else "*", else null when no group applies. */
export function governingAgent(robots: Robots, agents: string | string[]): string | null {
  const tokens = [...[agents].flat().map((agent) => agent.toLowerCase()), '*']
  return tokens.find((token) => robots.groups.some((group) => group.agents.includes(token))) ?? null
}

function rulesFor(robots: Robots, agents: string[]): Rule[] {
  const agent = governingAgent(robots, agents)
  return robots.groups.filter((group) => agent !== null && group.agents.includes(agent)).flatMap((group) => group.rules)
}

/** "Googlebot/2.1" and "googlebot" name the same crawler: the token is the leading letters, "_" and "-". */
function agentToken(value: string): string {
  return value.startsWith('*') ? '*' : value.match(/^[a-z_-]*/i)![0].toLowerCase()
}

/** Percent-encodes non-ASCII characters and uppercases escapes, so "/каталог" matches "/%D0%BA...". */
function normalize(value: string): string {
  return value
    .replace(/[^\x00-\x7f]/gu, (char) => encodeURIComponent(char))
    .replace(/%[\da-f]{2}/gi, (escape) => escape.toUpperCase())
}

/**
 * Google's matcher: `*` is any sequence, a final `$` anchors the end. It tracks the path positions reachable
 * so far instead of using a regex, so a hostile pattern cannot make it backtrack for minutes.
 */
function matches(pattern: string, path: string): boolean {
  let positions = [0]
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '$' && i === pattern.length - 1) return positions.at(-1) === path.length
    if (char === '*') {
      positions = Array.from({ length: path.length - positions[0] + 1 }, (_, k) => positions[0] + k)
    } else {
      positions = positions.filter((position) => path[position] === char).map((position) => position + 1)
      if (positions.length === 0) return false
    }
  }
  return true
}
