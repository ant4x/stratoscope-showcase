// Excerpt from Stratoscope: src/lib/scan/collect.ts. Omitted: imports, types, the helpers that pick pages and probe addresses (sitemapPages, sitemapUrl, htmlPage) and the MAX_SCRIPT_FILES and HOME_FILES constants. Source is private.

/** Time limit for all requests of one scan. */
export const DEADLINE_MS = 50_000

/** Time to read all pages of one scan. The 21 pages of a real site take about a second at most. */
const READ_TOTAL_MS = 6000

/** Requests to the site at once, like a person with a few tabs open. */
const PARALLEL = 3

/**
 * Downloads what the checks need, in four waves: the home page (HTTPS, HTTP and the www mirror at once),
 * then robots.txt on the origin where the home page ended up (with the home page once more under the ChatGPT search
 * crawler's signature when it is empty without JavaScript), then the sitemap it lists or /sitemap.xml
 * together with /llms.txt, the page's own script files when they are needed, the home page at /index.html and
 * /index.php and a made-up address, then up to 20 pages of the site.
 * Google's speed data for the home page is asked for alongside waves 2-4, within a longer deadline of its own.
 * `onStage` hears each wave as it starts, for a page that shows the scan's progress.
 * The only step of a scan that uses the network. The owner's words about the business are added by the caller.
 */
export async function collect(
  host: string,
  { fetchPage = safeFetch, deadlineMs = DEADLINE_MS, speedDeadlineMs = SPEED_DEADLINE_MS, readTotalMs = READ_TOTAL_MS, measureSpeed, onStage }:
    { fetchPage?: FetchPage; deadlineMs?: number; speedDeadlineMs?: number; readTotalMs?: number; measureSpeed?: MeasureSpeed; onStage?: (stage: CollectStage) => void } = {},
): Promise<Omit<ScanContext, 'business'>> {
  const deadline = AbortSignal.timeout(deadlineMs)
  const speedDeadline = AbortSignal.timeout(speedDeadlineMs)
  const get = (url: string) => attempt(() => fetchPage(url, deadline))
  const getStart = (url: string) => attempt(() => fetchPage(url, deadline, { partial: true }))
  const read = reader(readTotalMs)

  onStage?.('home')
  const [https, http, mirror] = await Promise.all([
    get(`https://${host}/`),
    get(`http://${host}/`),
    get(`https://${mirrorHost(host)}/`),
  ])
  const home = https.ok ? https.response : http.ok ? http.response : null
  if (!home) {
    return { host, https, http, mirror, home, page: null, robots: null, sitemap: null, sitemapUrls: null, llmsTxt: null, botCopy: null, scriptFiles: [], homeCopies: [], missingPage: null, pages: [], repeats: [], closedPages: 0, speed: null }
  }

  const page = isSuccess(home) ? read(home) : null
  const speed = measureSpeed && page ? measureSpeed(home.url, speedDeadline) : null
  const asBot = page && isEmptyApp(page) && !onLovable(page)
    ? attempt(() => fetchPage(home.url, deadline, { headers: { 'user-agent': SEARCH_BOT_SIGNATURE } }))
    : null
  onStage?.('robots')
  const [robots, botAnswer] = await Promise.all([get(new URL('/robots.txt', home.url).href), asBot])
  const botCopy = botAnswer?.ok && isSuccess(botAnswer.response) ? read(botAnswer.response) : null
  const llmsTxtUrl = new URL('/llms.txt', home.url).href
  onStage?.('sitemap')
  const scripts = scriptFileUrls(page, robots, home.url)
  const { copies, missing } = probeUrls(page, robots, home.url)
  const sitemapAt = sitemapUrl(robots, home.url)
  const [sitemap, llmsTxt, ...rest] = await inTurns([sitemapAt, llmsTxtUrl, ...scripts, ...copies, ...missing], (url) => (url === sitemapAt ? getStart(url) : get(url)))
  const scriptFiles = rest.slice(0, scripts.length)
  const homeCopies = rest.slice(scripts.length, scripts.length + copies.length)
  const missingPage = missing.length > 0 ? rest[rest.length - 1] : null
  onStage?.('pages')
  const listed = page ? await sitemapPages(sitemap, getStart) : { pages: [], whole: false }
  const { pages, repeats, closedPages } = page ? await openPages(page, robots, listed.pages, get, read) : { pages: [], repeats: [], closedPages: 0 }
  const sitemapUrls = listed.whole ? listed.pages : null
  return { host, https, http, mirror, home, page, robots, sitemap, sitemapUrls, llmsTxt, botCopy, scriptFiles, homeCopies, missingPage, pages, repeats, closedPages, speed: await speed }
}

/**
 * Parses pages within a time budget shared by the whole scan, on top of each page's own (`READ_BUDGET_MS`):
 * otherwise a site could make each of its 21 pages slow to read. A page past the budget is not read.
 */
function reader(totalMs: number): Read {
  let left = totalMs
  return (response) => {
    if (left <= 0) return null
    const started = performance.now()
    const page = parsePage(decodeHtml(response.body, response.headers['content-type']), response.url, Math.min(READ_BUDGET_MS, left))
    left -= performance.now() - started
    return page
  }
}

/** Runs `task` for every URL, at most PARALLEL at a time; results keep the order of `urls`. */
async function inTurns(urls: string[], task: Get): Promise<FetchOutcome[]> {
  const results: FetchOutcome[] = []
  let next = 0
  async function worker() {
    while (next < urls.length) {
      const index = next++
      results[index] = await task(urls[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, urls.length) }, worker))
  return results
}
