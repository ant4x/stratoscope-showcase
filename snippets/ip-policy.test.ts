// From Stratoscope: src/lib/scan/net/ip-policy.test.ts (full file). Source is private.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPublicAddress } from './ip-policy.ts'

const PUBLIC = [
  '8.8.8.8',
  '1.1.1.1',
  '172.32.0.1',
  '2606:4700:4700::1111',
  '2a00:1450:4001:82a::200e',
]

const BLOCKED = [
  '0.0.0.0',
  '10.1.2.3',
  '100.64.0.1',
  '100.100.100.200',
  '127.0.0.1',
  '127.255.255.254',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.1.1',
  '198.18.0.1',
  '203.0.113.5',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  'fe80::1',
  'fe80::1%1',
  'fc00::1',
  'fd12:3456::1',
  'fd00:ec2::254',
  'ff02::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:8.8.8.8',
  '64:ff9b::7f00:1',
  '2001:db8::1',
  '2001:0:4136:e378::1',
  '2002:7f00:1::1',
  'localhost',
  'not-an-ip',
]

test('allows public unicast addresses', () => {
  for (const address of PUBLIC) assert.equal(isPublicAddress(address), true, address)
})

test('blocks private, reserved and disguised addresses', () => {
  for (const address of BLOCKED) assert.equal(isPublicAddress(address), false, address)
})
