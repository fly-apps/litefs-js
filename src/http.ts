// this is utilities for node's http module
import type http from 'http'
import {
	checkCookieForTransactionalConsistency,
	getInstanceInfo,
	getTxNumber,
	getTxSetCookieHeader,
} from '.'

/**
 * If the current instance is the primary instance, then returns false.
 * Otherwise, this will set the response status code to 409 and the
 * fly-replay header to the primary instance. It will also end the response.
 * @param {http.ServerResponse} res the http response object
 * @returns {Promise<boolean>} whether the request was replayed
 * @example
 * import { ensurePrimary } from "litefs-js/http";
 * ...
 * const replayed = await ensurePrimary(res);
 * if (replayed) return;
 * ...
 */
export async function ensurePrimary(
	res: http.ServerResponse,
): Promise<boolean> {
	const { currentIsPrimary, primaryInstance } = await getInstanceInfo()
	if (currentIsPrimary) return false

	res.writeHead(409, {
		'fly-replay': `instance=${primaryInstance}`,
	})
	res.end()
	return true
}

/**
 * Sets a cookie on the response object that will be used to ensure
 * transactional consistency.
 *
 * **NOTE**: It's very important that you do this *after* mutations to the
 * database, otherwise you'll be setting the cookie to a value that is
 * out of date.
 *
 * @param {http.ServerResponse} res the http response object
 * @example
 * import { setTxCookie } from "litefs-js/http";
 * ...
 * setTxCookie(res);
 * ...
 * @returns {Promise<void>}
 */
export async function setTxCookie(res: http.ServerResponse): Promise<void> {
	appendHeader(res, 'Set-Cookie', getTxSetCookieHeader(await getTxNumber()))
}

/**
 * Deletes the cookie that is used to ensure transactional consistency.
 * @param {http.ServerResponse} res the http response object
 * @example
 * import { deleteTxCookie } from "litefs-js/http";
 * ...
 * await deleteTxCookie(res);
 * ...
 * @returns {Promise<void>}
 */
export async function deleteTxCookie(res: http.ServerResponse): Promise<void> {
	appendHeader(
		res,
		'Set-Cookie',
		getTxSetCookieHeader(0, { expires: new Date(0) }),
	)
}

export function appendHeader(
	res: http.ServerResponse,
	name: string,
	value: string,
) {
	const header = res.getHeader(name)
	res.setHeader(
		name,
		[...(header ? (Array.isArray(header) ? header : [header]) : []), value].map(
			h => String(h),
		),
	)
}

/**
 * Ensures that the transactional consistency cookie is set on the response object.
 * If the current instance is the primary instance, then the cookie will be deleted.
 * If the current instance is not the primary instance, then the cookie will be
 * deleted if the transaction number in the cookie is up to date. If the transaction
 * number in the cookie is not up to date, then the response will be replayed from
 * the primary instance.
 * @param {http.IncomingMessage} req the http request object
 * @param {http.ServerResponse} res the http response object
 * @example
 * import { handleTransactionalConsistency } from "litefs-js/http";
 * ...
 * const replayed = await handleTransactionalConsistency(req, res);
 * if (replayed) return;
 * ...
 * @returns {Promise<boolean>} - whether the response was replayed
 */
export async function handleTransactionalConsistency(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): Promise<boolean> {
	const result = await checkCookieForTransactionalConsistency(
		req.headers.cookie,
	)
	if (result.type === 'replay') {
		res.writeHead(409, { 'fly-replay': result.flyReplayHeader })
		res.end()
		return true
	}
	if (result.type === 'ok') return false
	if (result.type === 'delete-cookie') {
		await deleteTxCookie(res)
		return false
	}
	throw new Error(`Unknown status type ${result}`)
}
