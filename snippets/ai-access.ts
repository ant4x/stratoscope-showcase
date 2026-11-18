// Excerpt from Stratoscope: src/lib/scan/ai-access.ts (full file). Source is private.
import { AI_BOTS } from './ai-bots.ts'
import type { AiBot } from './ai-bots.ts'
import { isRefused, isSuccess, skipped, usable } from './responses.ts'
import { governingAgent, isAllowed, parseRobots } from './robots.ts'
import type { Robots } from './robots.ts'
import type { ScanContext, Skip } from './types.ts'

/**
 * How robots.txt treats one AI crawler. `home`: whether it may open the home page, or `ignored` when the crawler
 * does not obey robots.txt. `likeGoogle`: closed by the same group that closes the home page to Googlebot, which the
 * robots.txt check already reports. `closedPages`: pages the scan opened that the crawler may not, while the home page is open.
 */
export type BotAccess = AiBot & {
  home: 'open' | 'closed' | 'ignored'
  likeGoogle: boolean
  closedPages: string[]
}

/** /llms.txt as the report shows it: its address when the site has one, or why there is none to show. */
export type LlmsTxt = { url: string } | 'not-found' | 'not-checked'

const NO_RULES: Robots = { groups: [], sitemaps: [] }

/**
 * Whether the site has /llms.txt. Many sites answer any address with an HTML page and status 200, or redirect
 * it to the home page, so only a text answer that stayed at /llms.txt counts.
 */
export function llmsTxtFact({ llmsTxt }: ScanContext): LlmsTxt {
  if (!llmsTxt?.ok || isRefused(llmsTxt.response) || llmsTxt.response.status >= 500) return 'not-checked'
  const { response } = llmsTxt
  if (!isSuccess(response) || new URL(response.url).pathname !== '/llms.txt') return 'not-found'
  const text = response.body.toString('utf8').trim()
  const html = (response.headers['content-type'] ?? '').includes('html') || text.startsWith('<')
  return text === '' || html ? 'not-found' : { url: response.url }
}

/** Every AI crawler of ai-bots.json against robots.txt, or why that cannot be told. A missing robots.txt (4xx) opens everything. */
export function aiBotAccess({ home, robots, pages }: ScanContext): BotAccess[] | Skip {
  const response = usable('robots', robots)
  if ('reason' in response) return response
  const { status } = response
  if (status >= 500) {
    return skipped('not-loaded', 'robots-server-error', null, { status }, () => `robots.txt answered with a server error (HTTP ${status}), so the rules for AI crawlers were not checked.`)
  }
  const rules = isSuccess(response) ? parseRobots(response.body) : NO_RULES
  const homeUrl = home!.url
  const googleGroup = isAllowed(rules, 'googlebot', homeUrl) ? null : governingAgent(rules, 'googlebot')
  const opened = pages.filter(({ outcome }) => outcome.ok).map(({ url }) => url)

  return AI_BOTS.map((bot) => {
    if (bot.level === 'ignores-robots') return { ...bot, home: 'ignored', likeGoogle: false, closedPages: [] }
    const agents = bot.rulesIfMissing ? [bot.token, bot.rulesIfMissing] : [bot.token]
    const open = isAllowed(rules, agents, homeUrl)
    return {
      ...bot,
      home: open ? 'open' : 'closed',
      likeGoogle: !open && googleGroup !== null && governingAgent(rules, agents) === googleGroup,
      closedPages: open ? opened.filter((url) => !isAllowed(rules, agents, url)) : [],
    }
  })
}
