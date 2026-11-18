// Excerpt from Stratoscope: src/lib/scan/web/access.ts. Most store keys are omitted. Source is private.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { Store } from './store.ts'

export const DAY = 86_400
/** A report lives a week, and a site is scanned once a week: a second request shows the same report. */
export const WEEK = 7 * DAY
/** Scans a day from one address and reports a day to one email: also at most three emails to someone else's inbox. */
export const PER_DAY = 3

/** Where the web version keeps things. Visitor IPs, emails and link tokens appear in keys only as hashes. */
export const keys = {
  report: (id: string) => `scan:report:${id}`,
  site: (host: string) => `scan:site:${host}`,
  /** A visitor's secret link: which report it opens and the visitor's own words about the business. */
  view: (token: string) => `scan:view:${digest(token)}`,
  visitor: (ipHash: string) => `scan:visitor:${ipHash}`,
  mailbox: (email: string) => `scan:mailbox:${digest(email)}`,
}

export function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The visitor's address as an HMAC with our secret: enough to count scans, useless to anyone who reads the store. */
export function visitorHash(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex')
}

/** A secret link to a report: 192 random bits; only its hash is stored. */
export function newToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Counts one more use of `key` today and tells whether it is still within the daily limit. */
export async function withinLimit(store: Store, key: string): Promise<boolean> {
  return (await store.increment(key, DAY)) <= PER_DAY
}
