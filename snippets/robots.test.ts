// From Stratoscope: src/lib/scan/robots.test.ts (full file). Source is private.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { governingAgent, isAllowed, parseRobots } from './robots.ts'

function robots(text: string) {
  return parseRobots(Buffer.from(text))
}

function allowed(text: string, path: string, agent = 'googlebot'): boolean {
  return isAllowed(robots(text), agent, `https://example.com${path}`)
}

function blockedPaths(text: string, paths: string[]): string[] {
  return paths.filter((path) => !allowed(text, path))
}

test('matches path prefixes case-sensitively (Google examples)', () => {
  const rules = 'User-agent: *\nDisallow: /fish'
  assert.deepEqual(
    blockedPaths(rules, ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fish.php?id=1', '/Fish.asp', '/catfish', '/?id=fish']),
    ['/fish', '/fish.html', '/fish/salmon.html', '/fishheads', '/fish.php?id=1'],
  )
  assert.deepEqual(
    blockedPaths('User-agent: *\nDisallow: /fish/', ['/fish/', '/fish/?id=1', '/fish', '/fish.html', '/animals/fish/']),
    ['/fish/', '/fish/?id=1'],
  )
})

test('supports * and a final $ (Google examples)', () => {
  const paths = ['/index.php', '/folder/a.php?x=1', '/a.php/', '/a.php5', '/windows.PHP', '/']
  assert.deepEqual(blockedPaths('User-agent: *\nDisallow: /*.php', paths), ['/index.php', '/folder/a.php?x=1', '/a.php/', '/a.php5'])
  assert.deepEqual(blockedPaths('User-agent: *\nDisallow: /*.php$', paths), ['/index.php'])
  assert.deepEqual(
    blockedPaths('User-agent: *\nDisallow: /fish*.php', ['/fish.php', '/fishheads/catfish.php?x=1', '/Fish.PHP']),
    ['/fish.php', '/fishheads/catfish.php?x=1'],
  )
})

test('the longest matching rule wins, and allow wins a tie (Google examples)', () => {
  assert.equal(allowed('User-agent: *\nAllow: /p\nDisallow: /', '/page'), true)
  assert.equal(allowed('User-agent: *\nAllow: /folder\nDisallow: /folder', '/folder/page'), true)
  assert.equal(allowed('User-agent: *\nDisallow: /folder\nAllow: /folder', '/folder/page'), true)
  assert.equal(allowed('User-agent: *\nAllow: /page\nDisallow: /*.htm', '/page.htm'), false)
  assert.equal(allowed('User-agent: *\nDisallow: /*.ph\nAllow: /page', '/page.php'), true)
  assert.equal(allowed('User-agent: *\nAllow: /$\nDisallow: /', '/'), true)
  assert.equal(allowed('User-agent: *\nAllow: /$\nDisallow: /', '/page.htm'), false)
})

test('an agent follows its own group and ignores the * group', () => {
  const rules = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private'
  assert.equal(allowed(rules, '/', 'googlebot'), true)
  assert.equal(allowed(rules, '/private', 'googlebot'), false)
  assert.equal(allowed(rules, '/', 'stratoscope'), false)
})

test('combines groups for the same agent and shares a group between agents (RFC 9309)', () => {
  const rules = [
    'User-agent: googlebot', 'Disallow: /a',
    'User-agent: other', 'Disallow: /c',
    'User-agent: bingbot', 'User-agent: Googlebot/2.1', 'Disallow: /b',
  ].join('\n')
  assert.deepEqual(blockedPaths(rules, ['/a', '/b', '/c']), ['/a', '/b'])
  assert.equal(allowed(rules, '/b', 'bingbot'), false)
})

test('a crawler can follow another crawler\'s group when it has none of its own, like Applebot follows Googlebot', () => {
  const rules = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private'
  const applebot = ['Applebot', 'Googlebot']
  assert.equal(isAllowed(robots(rules), applebot, 'https://example.com/'), true)
  assert.equal(isAllowed(robots(rules), applebot, 'https://example.com/private'), false)
  assert.equal(isAllowed(robots(`${rules}\n\nUser-agent: Applebot\nDisallow: /`), applebot, 'https://example.com/'), false)
  assert.equal(isAllowed(robots('User-agent: *\nDisallow: /'), applebot, 'https://example.com/'), false)
})

test('names the token whose group applies, or null when none does', () => {
  const rules = robots('User-agent: *\nDisallow: /tmp\n\nUser-agent: GPTBot\nDisallow: /')
  assert.equal(governingAgent(rules, 'GPTBot'), 'gptbot')
  assert.equal(governingAgent(rules, 'ClaudeBot'), '*')
  assert.equal(governingAgent(rules, ['Applebot', 'GPTBot']), 'gptbot')
  assert.equal(governingAgent(robots('User-agent: GPTBot\nDisallow: /'), 'ClaudeBot'), null)
})

test('allows everything when nothing applies', () => {
  assert.equal(allowed('', '/'), true)
  assert.equal(allowed('Disallow: /\nUser-agent: *\nDisallow:', '/'), true)
  assert.equal(allowed('User-agent: bingbot\nDisallow: /', '/'), true)
  assert.equal(allowed('User-agent: *\nDisallow: /', '/robots.txt'), true)
})

test('collects sitemaps anywhere without breaking the group', () => {
  const parsed = robots('User-agent: *\nSitemap: https://example.com/a.xml\nDisallow: /private\nsitemap: https://example.com/b.xml')
  assert.deepEqual(parsed.sitemaps, ['https://example.com/a.xml', 'https://example.com/b.xml'])
  assert.equal(isAllowed(parsed, 'googlebot', 'https://example.com/private'), false)
})

test('handles comments, CRLF, a BOM and letter case in keys', () => {
  const text = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('USER-AGENT: * # everyone\r\nDISALLOW: /admin # back office\r\n'),
  ])
  assert.equal(isAllowed(parseRobots(text), 'googlebot', 'https://example.com/admin/'), false)
})

test('matches paths written in Cyrillic against encoded URLs', () => {
  assert.equal(allowed('User-agent: *\nDisallow: /каталог', '/каталог/стулья'), false)
  assert.equal(allowed('User-agent: *\nDisallow: /%d0%ba', '/каталог'), false)
})

test('reads only the first 500 KiB, like Google', () => {
  const text = `User-agent: *\nDisallow: /a\n#${'x'.repeat(500 * 1024)}\nDisallow: /b`
  assert.deepEqual(blockedPaths(text, ['/a', '/b']), ['/a'])
})

test('a hostile pattern does not hang the matcher', () => {
  const rules = `User-agent: *\nDisallow: /${'*a'.repeat(100)}b`
  assert.equal(allowed(rules, `/${'a'.repeat(5000)}`), true)
})

test('a pattern of many stars costs no more than reading it, for every link of a page', () => {
  // Each * used to build an array as long as the path: 100,000 stars took 6 s for one address.
  for (const pattern of ['*'.repeat(100_000), '*a'.repeat(50_000)]) {
    const parsed = robots(`User-agent: *\nDisallow: /${pattern}x`)
    const start = performance.now()
    for (let link = 0; link < 50; link++) isAllowed(parsed, 'googlebot', `https://example.com/${'a'.repeat(1000)}${link}`)
    assert.ok(performance.now() - start < 500, `50 links took ${Math.round(performance.now() - start)} ms`)
  }
})
