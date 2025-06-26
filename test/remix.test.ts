import { test } from 'node:test'
import assert from 'node:assert'
import * as cookie from 'cookie'
import { setupPrimary, setupReplica, setupTxNumber } from './utils'
import {
	appendTxNumberCookie,
	ensurePrimary,
	handleTransactionalConsistency,
	ensureInstance,
} from '../src/remix'
import { TXID_NUM_COOKIE_NAME } from '../src'

await test('ensurePrimary() does not throw a Response when on primary', async () => {
	await setupPrimary()
	await ensurePrimary()
})

await test('ensurePrimary() throws a Response when on replica', async () => {
	const primary = await setupReplica()
	const response = await ensurePrimary().catch(r => r)
	assert.equal(response.status, 302)
	assert.equal(response.headers.get('fly-replay'), `instance=${primary}`)
})

await test('handleTransactionalConsistency() returns ok if you do not have a txnum cookie', async () => {
	await setupReplica()
	const req = new Request('http://localhost:3000')
	const result = await handleTransactionalConsistency(req)
	assert.equal(result.type, 'ok')
})

await test('handleTransactionalConsistency() returns delete-cookie if you have an invalid cookie for txnum', async () => {
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

await test('handleTransactionalConsistency() returns replay if the txnum is old', async () => {
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
	assert.equal(response.status, 302)
	assert.equal(response.headers.get('fly-replay'), `instance=${primary}`)
})

await test('appendTxNumberCookie() does nothing for GET requests', async () => {
	await setupPrimary()
	const request = new Request('http://localhost:3000')
	const headers = new Headers()
	await appendTxNumberCookie(request, headers)
	assert.equal(headers.get('Set-Cookie'), null)
})

await test('appendTxNumberCookie() does nothing in replica instances', async () => {
	await setupReplica()
	const request = new Request('http://localhost:3000', { method: 'POST' })
	const headers = new Headers()
	await appendTxNumberCookie(request, headers)
	assert.equal(headers.get('Set-Cookie'), null)
})

await test('appendTxNumberCookie() adds a txnum cookie on primary POST requests', async () => {
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

await test('ensureInstance() resolves when instance matches currentInstance', async () => {
	await setupPrimary()
	// get the current instance name
	const { currentInstance } = await import('../src').then(m =>
		m.getInstanceInfo(),
	)
	await ensureInstance(currentInstance)
})

await test('ensureInstance() throws a Response when instance does not match currentInstance', async () => {
	await setupPrimary()
	const fakeInstance = 'not-the-current-instance'
	const response = await ensureInstance(fakeInstance).catch(r => r)
	assert.equal(response.status, 302)
	assert.equal(response.headers.get('fly-replay'), `instance=${fakeInstance}`)
})
