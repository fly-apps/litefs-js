import { test } from 'node:test'
import assert from 'node:assert'
import cookie from 'cookie'
import { setupPrimary, setupReplica, setupTxNumber } from './utils'
import {
	appendTxNumberCookie,
	ensurePrimary,
	handleTransactionalConsistency,
} from '../src/remix'
import { TXID_NUM_COOKIE_NAME } from '../src'

test('ensurePrimary() does not throw a Response when on primary', async () => {
	await setupPrimary()
	await ensurePrimary()
})

test('ensurePrimary() throws a Response when on replica', async () => {
	const primary = await setupReplica()
	const response = await ensurePrimary().catch(r => r)
	assert.equal(response.status, 409)
	assert.equal(response.headers.get('fly-replay'), `instance=${primary}`)
})

test('handleTransactionalConsistency() returns ok if you do not have a txnum cookie', async () => {
	await setupReplica()
	const req = new Request('http://localhost:3000')
	const result = await handleTransactionalConsistency(req)
	assert.equal(result.type, 'ok')
})

test('handleTransactionalConsistency() returns delete-cookie if you have an invalid cookie for txnum', async () => {
	await setupReplica()
	const req = new Request('http://localhost:3000', {
		headers: {
			cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, 'invalid'),
		},
	})
	const result = await handleTransactionalConsistency(req)
	assert.equal(result.type, 'delete-cookie')
	if (result.type === 'delete-cookie') {
		const cookies = cookie.parse(result.setCookieHeader)
		assert.equal(cookies.Expires, new Date(0).toUTCString())
	}
})

test('handleTransactionalConsistency() returns replay if the txnum is old', async () => {
	const primary = await setupReplica()
	const currentTxNumber = 2
	const clientTxNumber = currentTxNumber + 1
	await setupTxNumber(currentTxNumber)
	const req = new Request('http://localhost:3000', {
		headers: {
			cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, clientTxNumber.toString()),
		},
	})
	const response = await handleTransactionalConsistency(req).catch(r => r)
	assert.equal(response.status, 409)
	assert.equal(response.headers.get('fly-replay'), `instance=${primary}`)
})

test('appendTxNumberCookie() does nothing for GET requests', async () => {
	await setupPrimary()
	const request = new Request('http://localhost:3000')
	const headers = new Headers()
	await appendTxNumberCookie(request, headers)
	assert.equal(headers.get('Set-Cookie'), null)
})

test('appendTxNumberCookie() does nothing in replica instances', async () => {
	await setupReplica()
	const request = new Request('http://localhost:3000', { method: 'POST' })
	const headers = new Headers()
	await appendTxNumberCookie(request, headers)
	assert.equal(headers.get('Set-Cookie'), null)
})

test('appendTxNumberCookie() adds a txnum cookie on primary POST requests', async () => {
	await setupPrimary()
	const txnum = 10
	await setupTxNumber(txnum)
	const request = new Request('http://localhost:3000', { method: 'POST' })
	const headers = new Headers()
	await appendTxNumberCookie(request, headers)
	const cookieHeader = headers.get('Set-Cookie')
	assert.ok(cookieHeader)
	const cook = cookie.parse(cookieHeader)
	assert.equal(cook[TXID_NUM_COOKIE_NAME], txnum.toString())
})
