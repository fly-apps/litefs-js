import cookie from 'cookie'
import assert from 'node:assert'
import { it, describe, before } from 'node:test'
import {
	getEnsurePrimaryMiddleware,
	getSetTxNumberMiddleware,
	getTransactionalConsistencyMiddleware,
} from '../src/express'
import { TXID_NUM_COOKIE_NAME } from '../src'
import {
	createServer,
	setupPrimary,
	setupReplica,
	setupTxNumber,
	sleep,
} from './utils'

describe(() => {
	let app: Awaited<ReturnType<typeof createServer>>['app'],
		fetch: Awaited<ReturnType<typeof createServer>>['fetch']

	const otherCookieRoute = '/other-cookie'
	const otherCookieKey = 'other'
	const otherCookieValue = 'cookie'

	const ensurePrimaryRoute = '/ensure-primary'

	before(async () => {
		const server = await createServer()
		app = server.app
		fetch = server.fetch
		app.post(otherCookieRoute, (req, res, next) => {
			res.cookie(otherCookieKey, otherCookieValue)
			if (req.query.multiple) {
				assert.ok(typeof req.query.multiple === 'string')
				const [name, value] = req.query.multiple.split('=')
				res.cookie(name, value)
			}
			next()
		})
		app.use(ensurePrimaryRoute, getEnsurePrimaryMiddleware(), (req, res) =>
			res.send('ok'),
		)
		app.use(getTransactionalConsistencyMiddleware())
		app.use(getSetTxNumberMiddleware())
		app.get('/', (req, res) => res.send('ok'))
		app.post('/', (req, res) => res.send('ok'))
		app.post(otherCookieRoute, (req, res) => res.send('ok'))
	})

	it('getTransactionalConsistencyMiddleware() proceeds when on primary', async () => {
		await setupPrimary()
		const response = await fetch(`/`)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('fly-replay'), null)
	})

	it('getTransactionalConsistencyMiddleware() deletes an invalid txnum cookie', async () => {
		await setupPrimary()
		const response = await fetch(`/`, {
			headers: { cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, 'invalid') },
		})
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('fly-replay'), null)
		assert.notEqual(response.headers.get('Set-Cookie'), null)
		const cookies = cookie.parse(response.headers.get('Set-Cookie')!)
		assert.equal(cookies.Expires, new Date(0).toUTCString())
	})

	it('getTransactionalConsistencyMiddleware() deletes coookie if the user is ahead of the primary', async () => {
		await setupPrimary()
		const txNum = 1
		const usersTxNum = txNum + 1
		await setupTxNumber(txNum)
		const response = await fetch(`/`, {
			headers: {
				cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, usersTxNum.toString()),
			},
		})
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('fly-replay'), null)
		assert.notEqual(response.headers.get('Set-Cookie'), null)
		const cookies = cookie.parse(response.headers.get('Set-Cookie')!)
		assert.equal(cookies.Expires, new Date(0).toUTCString())
	})

	it('getTransactionalConsistencyMiddleware() replica lets the user through if it has as up-to-date a tx number as the user', async () => {
		await setupReplica()
		const txNum = 2
		const usersTxNum = txNum
		await setupTxNumber(txNum)
		const response = await fetch(`/`, {
			headers: {
				cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, usersTxNum.toString()),
			},
		})
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('fly-replay'), null)
		assert.notEqual(response.headers.get('Set-Cookie'), null)
		const cookies = cookie.parse(response.headers.get('Set-Cookie')!)
		assert.equal(cookies.Expires, new Date(0).toUTCString())
	})

	it('getTransactionalConsistencyMiddleware() waits for tx number to be updated on replica', async () => {
		await setupReplica()
		let txNum = 2
		const usersTxNum = txNum + 1
		await setupTxNumber(txNum)
		const responsePromise = fetch(`/`, {
			headers: {
				cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, usersTxNum.toString()),
			},
		})
		await sleep(10)
		txNum = usersTxNum
		await setupTxNumber(txNum)
		const response = await responsePromise
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('fly-replay'), null)
		assert.notEqual(response.headers.get('Set-Cookie'), null)
		const cookies = cookie.parse(response.headers.get('Set-Cookie')!)
		assert.equal(cookies.Expires, new Date(0).toUTCString())
	})

	it('getTransactionalConsistencyMiddleware() replays on replica if it takes too long for up-to-date txnum', async () => {
		const primary = await setupReplica()
		const txNum = 2
		const usersTxNum = txNum + 1
		await setupTxNumber(txNum)
		const response = await fetch(`/`, {
			headers: {
				cookie: cookie.serialize(TXID_NUM_COOKIE_NAME, usersTxNum.toString()),
			},
		})
		assert.equal(response.status, 409)
		assert.equal(response.headers.get('fly-replay'), `instance=${primary}`)
	})

	it('getSetTxNumberMiddleware() does nothing on replica instances', async () => {
		await setupReplica()
		const response = await fetch(`/`, { method: 'POST' })
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('Set-Cookie'), null)
	})

	it('getSetTxNumberMiddleware() does nothing on get requests', async () => {
		await setupPrimary()
		const response = await fetch(`/`)
		assert.equal(response.status, 200)
		assert.equal(response.headers.get('Set-Cookie'), null)
	})

	it('getSetTxNumberMiddleware() sets the tx number in the cookie', async () => {
		await setupPrimary()
		await setupTxNumber(1)
		const response = await fetch(`/`, { method: 'POST' })
		assert.equal(response.status, 200)
		assert.notEqual(response.headers.get('Set-Cookie'), null)
		const cookies = cookie.parse(response.headers.get('Set-Cookie')!)
		assert.equal(cookies[TXID_NUM_COOKIE_NAME], '1')
	})

	it('getSetTxNumberMiddleware() does not override other cookies', async () => {
		await setupPrimary()
		const txNum = 1
		await setupTxNumber(txNum)
		const response = await fetch(otherCookieRoute, { method: 'POST' })
		assert.equal(response.status, 200)
		const setCookieHeader = response.headers.get('Set-Cookie')
		assert.ok(setCookieHeader)
		const allCookies = setCookieHeader.split(', ').map(v => cookie.parse(v))
		const txnum = allCookies.find(v => v.hasOwnProperty(TXID_NUM_COOKIE_NAME))
		const other = allCookies.find(v => v.hasOwnProperty(otherCookieKey))
		assert.ok(txnum)
		assert.ok(other)
		assert.equal(txnum[TXID_NUM_COOKIE_NAME], txNum.toString())
		assert.equal(other[otherCookieKey], otherCookieValue)
	})

	it('getSetTxNumberMiddleware() does not override multiple other cookies', async () => {
		await setupPrimary()
		const txNum = 1
		await setupTxNumber(txNum)
		const anotherOtherCookieName = 'anotherother'
		const anotherOtherCookieValue = 'anotherothervalue'
		const response = await fetch(
			`${otherCookieRoute}?multiple=${encodeURIComponent(
				`${anotherOtherCookieName}=${anotherOtherCookieValue}`,
			)}`,
			{ method: 'POST' },
		)
		assert.equal(response.status, 200)
		const setCookieHeader = response.headers.get('Set-Cookie')
		assert.ok(setCookieHeader)
		const allCookies = setCookieHeader.split(', ').map(v => cookie.parse(v))
		const txnum = allCookies.find(v => v.hasOwnProperty(TXID_NUM_COOKIE_NAME))
		const other = allCookies.find(v => v.hasOwnProperty(otherCookieKey))
		const anotherOther = allCookies.find(v =>
			v.hasOwnProperty(anotherOtherCookieName),
		)
		assert.ok(txnum)
		assert.ok(other)
		assert.ok(anotherOther)
		assert.equal(txnum[TXID_NUM_COOKIE_NAME], txNum.toString())
		assert.equal(other[otherCookieKey], otherCookieValue)
		assert.equal(anotherOther[anotherOtherCookieName], anotherOtherCookieValue)
	})

	it('ensurePrimary() does nothing on the primary', async () => {
		await setupPrimary()
		const response = await fetch(ensurePrimaryRoute, { method: 'POST' })
		assert.equal(response.status, 200)
	})

	it('ensurePrimary() returns 409 on replica', async () => {
		const primary = await setupReplica()
		const response = await fetch(ensurePrimaryRoute, { method: 'POST' })
		assert.equal(response.status, 409)
		assert.equal(response.headers.get('fly-replay'), `instance=${primary}`)
	})
})
