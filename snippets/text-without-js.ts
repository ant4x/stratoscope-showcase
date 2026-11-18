// Excerpt from Stratoscope: src/lib/scan/js-shell.ts and src/lib/scan/checks/ai/text-without-js.ts (full files). Source is private.

// ---- js-shell.ts ----

import type { Page } from './html/page.ts'
import { isShell } from './responses.ts'

/** The script Lovable adds to every site it hosts. */
const LOVABLE_SCRIPT = '/~flock.js'

/** Almost no text and scripts that draw the page in the browser: AI crawlers that do not run scripts see it empty. */
export function isEmptyApp(page: Page): boolean {
  return isShell(page) && page.scripts.some(({ src }) => src)
}

/** Lovable hosting serves its script from the site's own address, whatever the site's code is. */
export function onLovable(page: Page): boolean {
  const { hostname } = new URL(page.url)
  return page.scripts.some(({ src }) => src !== null && new URL(src).hostname === hostname && new URL(src).pathname === LOVABLE_SCRIPT)
}

// ---- checks/ai/text-without-js.ts ----

import type { Page } from '../../html/page.ts'
import { isEmptyApp, onLovable } from '../../js-shell.ts'
import { pageAddress } from '../../pages.ts'
import { homePage, SHELL_TEXT_LENGTH } from '../../responses.ts'
import type { Check, Finding } from '../../types.ts'

/**
 * AI crawlers see the home page text without running scripts. Only the HTML is read, no third-party code is run.
 * Critical when the page has almost no text and loads scripts: it is drawn in the browser. Information instead when
 * Lovable hosts it (Lovable gives verified crawlers a ready copy we cannot see) or when the page asked with the ChatGPT
 * search crawler's signature has text (a copy by signature). Information too when the HTML links to none of the
 * site's pages while the sitemap lists some.
 */
export const aiTextCheck: Check = {
  id: 'ai/text-without-js',
  run(context) {
    const page = homePage(context, 'ai-text')
    if ('reason' in page) return page
    if (isEmptyApp(page)) {
      if (onLovable(page)) return [lovableCopy(page)]
      const forBots = context.botCopy?.textLength ?? 0
      return [forBots >= SHELL_TEXT_LENGTH ? copyForBots(page, forBots) : emptyPage(page)]
    }
    const listed = context.pages.filter(({ listed }) => listed).length
    if (listed > 0 && ownLinks(page) === 0) return [noLinks(page, listed)]
    return []
  },
}

function emptyPage(page: Page): Finding {
  return {
    code: 'ai-empty-without-js',
    severity: 'critical',
    message: `Without JavaScript the home page shows ${page.textLength} characters of text: the site draws its content with scripts in the browser. The crawlers of ChatGPT, Claude and Perplexity do not run scripts (Vercel's measurement, December 2024), so they see an almost empty page. Google and Apple run scripts, so the site can still show in Google, Gemini and Siri.`,
    verify: `Open view-source:${page.url} in Chrome: the page code has almost no text, only an empty block such as <div id="root"></div> and links to scripts.`,
    evidence: { characters: page.textLength, url: page.url },
  }
}

function lovableCopy(page: Page): Finding {
  return {
    code: 'ai-lovable-copy',
    severity: 'note',
    message: `Without JavaScript the home page shows ${page.textLength} characters of text, and the site is hosted on Lovable. Lovable says it gives verified crawlers of Google, Bing, ChatGPT, Perplexity, Claude and Gemini a ready copy of the page, so they should see the text; the scan cannot see that copy. A sturdier setup is Lovable's upgrade to TanStack Start, after which every visitor and crawler gets the same complete page: in the project settings choose Migrate to TanStack Start (10-35 credits), check the pages and publish again.`,
    verify: `Open view-source:${page.url}: the page code has almost no text and loads /~flock.js, the script Lovable adds to the sites it hosts. Lovable describes the copy for crawlers at https://docs.lovable.dev/features/seo-aeo.`,
    evidence: { characters: page.textLength, url: page.url },
  }
}

function copyForBots(page: Page, forBots: number): Finding {
  return {
    code: 'ai-copy-for-bots',
    severity: 'note',
    message: `Without JavaScript the home page shows ${page.textLength} characters of text, but asked with the signature of the ChatGPT search crawler it has ${forBots}: the site gives crawlers a ready copy, so AI crawlers see the text. Google calls such dynamic rendering a workaround, not a long-term solution: a page drawn on the server or when the site is built gives every visitor and crawler the same complete page.`,
    verify: `In Chrome open DevTools, then More tools, Network conditions, untick "Use browser default" and paste the OAI-SearchBot user agent from https://developers.openai.com/api/docs/bots. With DevTools still open, reload view-source:${page.url}: the code now has the page text.`,
    evidence: { characters: page.textLength, charactersForBots: forBots, url: page.url },
  }
}

function noLinks(page: Page, listed: number): Finding {
  return {
    code: 'ai-no-links-without-js',
    severity: 'info',
    message: `The home page HTML has no links to other pages of the site, while the scan found ${listed === 1 ? 'one page' : `${listed} pages`} in the sitemap: the menu appears only after scripts run. AI crawlers do not run scripts, so they cannot reach the site's sections from the home page.`,
    verify: `Open view-source:${page.url} and search for "<a href": there are no links to the site's own pages.`,
    evidence: { sitemapPages: listed, url: page.url },
  }
}

/** Links to other pages of the same site; links to the page itself, such as anchors, do not count. */
function ownLinks(page: Page): number {
  const { hostname } = new URL(page.url)
  return page.links.filter(({ href }) => new URL(href).hostname === hostname && pageAddress(href) !== pageAddress(page.url)).length
}
