// Excerpt from Stratoscope: src/lib/scan/net/ip-policy.ts (full file). Source is private.
import { BlockList, isIP } from 'node:net'

type Range = [network: string, prefix: number]

function listOf(type: 'ipv4' | 'ipv6', ranges: Range[]): BlockList {
  const list = new BlockList()
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, type)
  return list
}

const blockedV4 = listOf('ipv4', [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])

const globalV6 = listOf('ipv6', [['2000::', 3]])

const blockedV6 = listOf('ipv6', [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
])

/** True only for public unicast addresses. IPv6 is limited to global unicast 2000::/3. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blockedV4.check(address, 'ipv4')
  if (family === 6) return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6')
  return false
}
