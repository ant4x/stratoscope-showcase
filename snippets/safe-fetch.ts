// Excerpt from Stratoscope: src/lib/scan/net/safe-fetch.ts. Omitted: imports, result types, body reading, the SafeFetchError class and the REQUEST_HEADERS, REDIRECT_STATUSES, RETRY_DELAY_MS and TRANSIENT_ERRORS constants. Source is private.

export type FetchPolicy = {
  isAllowedAddress: (address: string) => boolean
  /** All addresses of a hostname, asked on every connection. A test answers here instead of DNS. */
  resolve: (hostname: string, options: LookupOptions) => Promise<LookupAddress[]>
  allowedPorts: number[]
  timeoutMs: number
  maxBytes: number
  maxRedirects: number
  retries: number
}

export const DEFAULT_POLICY: FetchPolicy = {
  isAllowedAddress: isPublicAddress,
  resolve: (hostname, options) => dnsLookup(hostname, { ...options, all: true }),
  allowedPorts: [80, 443],
  timeoutMs: 20_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  retries: 1,
}

/** Builds a client that only reaches addresses and ports allowed by the policy. */
export function createSafeFetch(policy: FetchPolicy) {
  const lookup = guardedLookup(policy)

  async function fetchOnce(input: string, deadline: AbortSignal | undefined, options: SendOptions): Promise<SafeResponse> {
    const timeout = AbortSignal.timeout(policy.timeoutMs)
    const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout
    const redirects: Redirect[] = []
    let url = new URL(input)

    try {
      for (;;) {
        assertAllowedUrl(url, policy)
        const res = await send(url, lookup, signal, options)
        const status = res.statusCode!
        const location = res.headers.location

        if (!REDIRECT_STATUSES.has(status) || !location) {
          const { body, truncated } = await readBody(res, policy.maxBytes, signal, options.partial)
          return { url: url.href, status, headers: res.headers, body, redirects, truncated }
        }

        res.destroy()
        if (redirects.length === policy.maxRedirects) {
          throw new SafeFetchError('TOO_MANY_REDIRECTS', `More than ${policy.maxRedirects} redirects`)
        }
        redirects.push({ url: url.href, status })
        const next = new URL(location, url)
        if (options.headers && next.origin !== url.origin) {
          throw new SafeFetchError('BLOCKED_URL', `A request with its own headers does not follow a redirect to ${next.origin}`)
        }
        url = next
      }
    } catch (error) {
      if (deadline?.aborted) throw new SafeFetchError('DEADLINE', 'The scan ran out of time')
      if (signal.aborted) throw new SafeFetchError('TIMEOUT', `No response within ${policy.timeoutMs} ms`)
      throw error
    }
  }

  /**
   * Tries once more on errors that usually pass: dropped connection, timeout, temporary DNS failure.
   * `deadline` is the time limit of the whole scan: when it fires, the request stops and is not retried.
   */
  return async function safeFetch(input: string, deadline?: AbortSignal, options: SendOptions = {}): Promise<SafeResponse> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchOnce(input, deadline, options)
      } catch (error) {
        const code = (error as { code?: string }).code ?? ''
        if (attempt >= policy.retries || !TRANSIENT_ERRORS.has(code)) throw error
        await delay(RETRY_DELAY_MS)
      }
    }
  }
}

export const safeFetch = createSafeFetch(DEFAULT_POLICY)

function assertAllowedUrl(url: URL, policy: FetchPolicy): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('BLOCKED_URL', `Protocol not allowed: ${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new SafeFetchError('BLOCKED_URL', 'Credentials in URL are not allowed')
  }
  const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80)
  if (!policy.allowedPorts.includes(port)) {
    throw new SafeFetchError('BLOCKED_URL', `Port not allowed: ${port}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !policy.isAllowedAddress(host)) {
    throw new SafeFetchError('BLOCKED_ADDRESS', `Address not allowed: ${host}`)
  }
}

/** Resolves the hostname at connect time and rejects it if any address is not allowed. */
function guardedLookup({ isAllowedAddress, resolve }: FetchPolicy): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, options).then((addresses) => {
      const blocked = addresses.find((entry) => !isAllowedAddress(entry.address))
      if (blocked) {
        return callback(new SafeFetchError('BLOCKED_ADDRESS', `${hostname} resolves to ${blocked.address}`), '')
      }
      if (options.all) return callback(null, addresses)
      callback(null, addresses[0].address, addresses[0].family)
    }, (error) => callback(error, ''))
  }
}

function send(url: URL, lookup: LookupFunction, signal: AbortSignal, { method = 'GET', body, headers }: SendOptions): Promise<IncomingMessage> {
  const options = { method, headers: { ...REQUEST_HEADERS, ...headers }, lookup, signal, agent: false }
  return new Promise((resolve, reject) => {
    const req = url.protocol === 'https:'
      ? httpsRequest(url, options, resolve)
      : httpRequest(url, options, resolve)
    req.on('error', reject).end(body)
  })
}
