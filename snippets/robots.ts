// Excerpt from Stratoscope: src/lib/scan/robots.ts (full file). Source is private.
/**
 * A rule with its pattern cut at `*` when robots.txt is read: the first and last pieces, and the non-empty ones
 * between; `literal` is how many characters the pieces need, so a rule longer than an address is passed over at once.
 */
export type Rule = { allow: boolean; pattern: string; pieces: string[]; anchored: boolean; literal: number }
export type Group = { agents: string[]; rules: Rule[] }
export type Robots = { groups: Group[]; sitemaps: string[] }

/** Google reads only the first 500 KiB of robots.txt. */
const MAX_BYTES = 500 * 1024

/** Characters the matcher may compare for one robots.txt, about 2 s: real files need a fraction, hostile ones stop here. */
const MAX_WORK = 1_000_000_000
const spent = new WeakMap<Robots, number>()

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
      if (group && value) group.rules.push(rule(key === 'allow', normalize(value)))
    } else if (key === 'sitemap' && value) {
      robots.sitemaps.push(value)
    }
  }
  return robots
}

/**
 * Whether a crawler may fetch `url`. `agents` are its product tokens in order of precedence, such as "googlebot",
 * or ["applebot", "googlebot"] for a crawler that follows Googlebot's rules when it has none of its own.
 * The longest matching pattern wins; on a tie, allow wins. Once matching one robots.txt has cost MAX_WORK, every
 * further address counts as closed: a hostile file cannot hold the scan, and nothing is opened without a check.
 */
export function isAllowed(robots: Robots, agents: string | string[], url: string): boolean {
  const { pathname, search } = new URL(url)
  if (pathname === '/robots.txt') return true
  const path = normalize(pathname + search)

  const rules = rulesFor(robots, [agents].flat())
  const work = (spent.get(robots) ?? 0) + rules.length * path.length
  spent.set(robots, work)
  if (work > MAX_WORK) return false

  let best: Rule | null = null
  for (const rule of rules) {
    if (!matches(rule, path)) continue
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

function rule(allow: boolean, pattern: string): Rule {
  const anchored = pattern.endsWith('$')
  const [first, ...rest] = (anchored ? pattern.slice(0, -1) : pattern).split('*')
  const last = rest.pop()
  const pieces = last === undefined ? [first] : [first, ...rest.filter(Boolean), last]
  return { allow, pattern, pieces, anchored, literal: pieces.reduce((sum, piece) => sum + piece.length, 0) }
}

/**
 * Google's matcher: `*` is any sequence, a final `$` anchors the end. Each piece of the pattern is found after the
 * previous one, earliest first: with `*` as the only wildcard the earliest match is never worse, so one pass decides.
 * Every piece found moves along the path, so a hostile pattern of many stars stops at the path's end.
 */
function matches({ pieces, anchored, literal }: Rule, path: string): boolean {
  if (literal > path.length) return false
  const first = pieces[0]
  if (!path.startsWith(first)) return false
  if (pieces.length === 1) return !anchored || path.length === first.length

  let position = first.length
  for (let i = 1; i < pieces.length - 1; i++) {
    const found = path.indexOf(pieces[i], position)
    if (found < 0) return false
    position = found + pieces[i].length
  }
  const last = pieces.at(-1)!
  return anchored ? path.length - last.length >= position && path.endsWith(last) : path.indexOf(last, position) >= 0
}
