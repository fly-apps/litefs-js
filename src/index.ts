import fs from 'fs'
import os from 'os'
import path from 'path'
import dns from 'dns'
import cookie from 'cookie'
import type { CookieSerializeOptions } from 'cookie'

type InstanceInfo = {
	/** the hostname of the primary instance (found in the `LITEFS_DIR/.primary` file if present, falls back to `os.hostname()`) */
	primaryInstance: string
	/** the hostname of the current instance (`os.hostname()`) */
	currentInstance: string
	/** whether the current instance is the primary instance (`primaryInstance === currentInstance`) */
	currentIsPrimary: boolean
}

/**
 * the directory where the .primary file is stored. Defaults to
 * process.env.LITEFS_DIR. This should be what you set your fuse.dir config to
 * in the litefs.yml config.
 */
export type LiteFSDir = string | undefined
/**
 * The filename of your sqlite database. Defaults to
 * process.env.DATABASE_FILENAME. This is used to determine the location of
 * the "-pos" file which LiteFS uses to track the transaction number.
 */
export type DatabaseFilename = string | undefined

/**
 * If the current instance is the primary instance, then there will be
 * no .primary file in the and the os.hostname() will be considered the primary.
 * If there is a .primary file, then the contents of that file will be the
 * hostname of the primary instance.
 *
 * NOTE: If you're using a consul lease strategy, do not cache the result of
 * this function. Instead, call it each time you need to know the instance info.
 * With the consul lease strategy, the .primary file may change at any time.
 * With a static lease strategy, the .primary file should not change and this
 * function can be cached if desired.
 *
 * @param {LiteFSDir} [litefsDir=process.env.LITEFS_DIR] - the directory where
 * the .primary file is stored. Defaults to process.env.LITEFS_DIR. This should
 * be what you set your fuse.dir config to in the litefs.yml config.
 *
 * @returns {Promise<InstanceInfo>} the primary instance hostname, the current
 * instance hostname, and whether the current instance is the primary instance
 */
export async function getInstanceInfo(
	litefsDir: LiteFSDir = process.env.LITEFS_DIR,
): Promise<InstanceInfo> {
	if (!litefsDir) {
		throw new Error(
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getInstanceInfo',
		)
	}
	const currentInstance = os.hostname()
	let primaryInstance
	try {
		primaryInstance = await fs.promises.readFile(
			path.join(litefsDir, '.primary'),
			'utf8',
		)
		primaryInstance = primaryInstance.trim()
	} catch {
		primaryInstance = currentInstance
	}
	return {
		primaryInstance,
		currentInstance,
		currentIsPrimary: currentInstance === primaryInstance,
	}
}

/**
 * Just like getInstanceInfo except this runs synchronously.
 *
 * @param {LiteFSDir} [litefsDir=process.env.LITEFS_DIR] - the directory where
 * the .primary file is stored. Defaults to process.env.LITEFS_DIR. This should
 * be what you set your fuse.dir config to in the litefs.yml config.
 *
 * @returns {InstanceInfo} the primary instance hostname, the current
 * instance hostname, and whether the current instance is the primary instance
 */
export function getInstanceInfoSync(
	litefsDir: LiteFSDir = process.env.LITEFS_DIR,
): InstanceInfo {
	if (!litefsDir) {
		throw new Error(
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getInstanceInfo',
		)
	}
	const currentInstance = os.hostname()
	let primaryInstance
	try {
		primaryInstance = fs.readFileSync(path.join(litefsDir, '.primary'), 'utf8')
		primaryInstance = primaryInstance.trim()
	} catch {
		primaryInstance = currentInstance
	}
	return {
		primaryInstance,
		currentInstance,
		currentIsPrimary: currentInstance === primaryInstance,
	}
}

/**
 * The name of the cookie that should be set in the client to identify the
 * transaction number
 */
export const TXID_NUM_COOKIE_NAME = 'txnum'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type WaitForUpToDateTxNumberOptions = {
	/**
	 * the directory where the .primary file is stored. Defaults to
	 * process.env.LITEFS_DIR. This should be what you set your fuse.dir config to
	 * in the litefs.yml config.
	 */
	litefsDir?: LiteFSDir
	/**
	 * The filename of your sqlite database. Defaults to
	 * process.env.DATABASE_FILENAME. This is used to determine the location of
	 * the "-pos" file which LiteFS uses to track the transaction number.
	 */
	databaseFilename?: DatabaseFilename
	/**
	 * The maximum amount of time (in milliseconds) to wait for the transaction
	 * number to catch up to the client's transaction number. Defaults to 500.
	 */
	timeoutMs?: number
	/**
	 * The amount of time (in milliseconds) to wait between checking the
	 * transaction number. Defaults to 30.
	 */
	intervalMs?: number
}

/**
 * @param {number} clientTxNumber - the transaction number that the client is
 * expecting
 * @param {WaitForUpToDateTxNumberOptions} [options]
 *
 * @returns {Promise<boolean>} - resolves to true if it's safe to continue or
 * false if the request should be replayed on the primary
 */
export async function waitForUpToDateTxNumber(
	clientTxNumber: number,
	{
		litefsDir,
		databaseFilename,
		timeoutMs = 500,
		intervalMs = 30,
	}: WaitForUpToDateTxNumberOptions = {},
): Promise<boolean> {
	let currentTxNumber = await getTxNumber(litefsDir, databaseFilename)
	if (currentTxNumber >= clientTxNumber) return true

	const stopTime = Date.now() + timeoutMs

	do {
		await sleep(intervalMs)
		currentTxNumber = await getTxNumber()
	} while (currentTxNumber >= clientTxNumber && Date.now() < stopTime)

	if (currentTxNumber >= clientTxNumber) {
		return true
	} else {
		console.error(`Timed out waiting for tx number 🚨`)
		return false
	}
}

/**
 * @param {LiteFSDir} [litefsDir=process.env.LITEFS_DIR] - the directory where
 * the .primary file is stored. Defaults to process.env.LITEFS_DIR. This should
 * be what you set your fuse.dir config to in the litefs.yml config.
 *
 * @param {DatabaseFilename} [databaseFilename=process.env.DATABASE_FILENAME]
 * - The filename of your sqlite database. Defaults to
 * process.env.DATABASE_FILENAME. This is used to determine the location of
 * the "-pos" file which LiteFS uses to track the transaction number.
 *
 * @returns {Promise<number>} the current transaction number
 */
export async function getTxNumber(
	litefsDir: LiteFSDir = process.env.LITEFS_DIR,
	databaseFilename: DatabaseFilename = process.env.DATABASE_FILENAME,
): Promise<number> {
	if (!litefsDir) {
		throw new Error(
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getTxNumber',
		)
	}
	if (!databaseFilename) {
		throw new Error(
			'litefs-js: DATABASE_FILENAME is not defined. You must either set the DATABASE_FILENAME environment variable or pass the databaseFilename argument to getTxNumber',
		)
	}
	try {
		const dbPos = await fs.promises.readFile(
			path.join(litefsDir, `${databaseFilename}-pos`),
			'utf-8',
		)
		return parseInt(dbPos.trim().split('/')[0], 16)
	} catch (error: unknown) {
		console.error(
			`Error reading ${databaseFilename}-pos (will default to "0"):`,
			error,
		)
		return 0
	}
}

/**
 * Creates a seralized cookie header for the txnum cookie which you should use
 * with a 'Set-Cookie' header to set the cookie in the client.
 *
 * @param {string} value - the value of the cookie (get this from `await getTxNumber()`).
 * @param {CookieSerializeOptions} [options] - options to pass to cookie.serialize
 * to override the defaults of path: "/", httpOnly: true, sameSite: "lax",
 * secure: true.
 *
 * @returns {number} the current transaction number
 */
export function getTxSetCookieHeader(
	value: number,
	options?: CookieSerializeOptions,
): string {
	return cookie.serialize(TXID_NUM_COOKIE_NAME, String(value), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		...options,
	})
}

type ConsistencyResult =
	| { type: 'ok' }
	| { type: 'delete-cookie'; setCookieHeader: string }
	| { type: 'replay'; flyReplayHeader: string; instance: string }
/**
 * Ensures that the transactional consistency cookie is set on the response object.
 * If the current instance is the primary instance, then the cookie will be deleted.
 * If the current instance is not the primary instance, then the cookie will be
 * deleted if the transaction number in the cookie is up to date. If the transaction
 * number in the cookie is not up to date, then the response will be replayed from
 * the primary instance.
 *
 * @param {string | null} cookieHeader - the value of the 'Cookie' header from the
 * request.
 *
 *  @example
 *  import { checkCookieForTransactionalConsistency } from "litefs-js/http";
 *  ...
 *  const status = await checkCookieForTransactionalConsistency(req, res);
 *  if (status === 'replay') {
 *  	res.setHeader('fly-replay', `instance=${primaryInstance}`)
 *  	res.writeHead(409)
 *  	res.end()
 *  	return true
 *  } else if (status === 'delete-cookie') {
 *  	appendHeader(res, 'Set-Cookie', getTxSetCookieHeader(0, { maxAge: 0 }))
 *  ...
 *  } else if (status === 'ok') {
 *  	// continue with request
 *  }
 *  ...
 *
 * @returns {Promise<ConsistencyResult>} - resolves to 'ok' if the request should continue,
 * 'delete-cookie' if the cookie should be deleted, or 'replay' if the request
 * should be replayed on the primary instance.
 */
export async function checkCookieForTransactionalConsistency(
	cookieHeader: string | null | undefined,
): Promise<ConsistencyResult> {
	const cookies = cookieHeader ? cookie.parse(cookieHeader) : {}

	const txCookieValue = cookies[TXID_NUM_COOKIE_NAME]
	const txCookieNumber = Number(txCookieValue)
	const isValidTxNumber = Number.isFinite(txCookieNumber)
	const deleteCookieHeader = () =>
		getTxSetCookieHeader(0, { expires: new Date(0) })
	if (!isValidTxNumber) {
		if (txCookieValue) {
			console.error(
				`Invalid tx number in cookie: ${txCookieValue}. Deleting cookie.`,
			)
			return { type: 'delete-cookie', setCookieHeader: deleteCookieHeader() }
		}
		return { type: 'ok' }
	}

	const { primaryInstance, currentIsPrimary } = await getInstanceInfo()
	const currentTxNumber = await getTxNumber()
	if (currentIsPrimary) {
		if (txCookieNumber > currentTxNumber) {
			console.error(
				`User somehow had a newer tx number (${txCookieNumber}) than the primary instance (${currentTxNumber}). Deleting cookie.`,
			)
		}
		return { type: 'delete-cookie', setCookieHeader: deleteCookieHeader() }
	}

	const txNumberIsUpToDate = await waitForUpToDateTxNumber(txCookieNumber)
	if (txNumberIsUpToDate) {
		return { type: 'delete-cookie', setCookieHeader: deleteCookieHeader() }
	} else {
		return {
			type: 'replay',
			flyReplayHeader: `instance=${primaryInstance}`,
			instance: primaryInstance,
		}
	}
}

/**
 * Returns the internal domain for the given instance.
 * @example
 * import { getInternalInstanceDomain } from "litefs-js/http";
 * ...
 * const internalDomain = getInternalInstanceDomain("primary")
 * // internalDomain === "http://5ef6ddf5.vm.myapp.internal:8081"
 * ...
 */
export function getInternalInstanceDomain(
	instance: string,
	port: string | void = process.env.INTERNAL_PORT ??
		process.env.PORT ??
		panic('INTERNAL_PORT or PORT must be set or a port must be supplied'),
) {
	// http and specify port for internal vm requests
	return `http://${instance}.vm.${process.env.FLY_APP_NAME}.internal:${port}`
}

/**
 * Gives an object of instance ids mapped to the region where they're hosted.
 * @example
 * import { getAllInstances } from "litefs-js/http";
 * ...
 * const instances = await getAllInstances()
 * // instances === { "5ef6ddf5": "maa", "5ef6ddf6": "sjc", "5ef6ddf7": "ams" }
 * ...
 */
export async function getAllInstances() {
	if (!process.env.FLY_APP_NAME) {
		return { [os.hostname()]: 'local' }
	}

	try {
		const rawTxts = await dns.promises.resolveTxt(
			`vms.${process.env.FLY_APP_NAME ?? 'local'}.internal`,
		)
		const instances = rawTxts
			.flat()
			.flatMap(r => r.split(','))
			.map(vm => vm.split(' '))
			.reduce<Record<string, string>>(
				(all, [instanceId, region]) =>
					instanceId && region ? { ...all, [instanceId]: region } : all,
				{},
			)
		return instances
	} catch (error: unknown) {
		console.error('Error getting all instances', error)
		return { [os.hostname()]: [process.env.FLY_REGION ?? 'local'] }
	}
}

function panic(message: string) {
	throw message
}
