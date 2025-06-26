// this is utilities for Remix which allows for throwing response objects
import {
	checkCookieForTransactionalConsistency,
	getInstanceInfo,
	getTxNumber,
	getTxSetCookieHeader,
} from './index.js'

export { getTxSetCookieHeader } from './index.js'

/**
 * If the current instance is the primary instance, then returns false.
 * Otherwise, this will throw a response object with a status code of 409 and
 * the fly-replay header set to the primary instance.
 * @returns {Promise<true>} if the current instance is the primary instance
 * @throws {Response} if the current instance is not the primary instance
 * @example
 * import { ensurePrimary } from "litefs-js/remix";
 * // in server-side code ...
 * await ensurePrimary();
 * ...
 */
export async function ensurePrimary(): Promise<boolean> {
	const { currentIsPrimary, primaryInstance } = await getInstanceInfo()
	if (currentIsPrimary) return true

	throw getReplayResponse(primaryInstance)
}

/**
 * This will throw a fly replay response if the current instance is not the
 * given instance.
 *
 * @param instance the instance you want to ensure is currently running
 * @returns {Promise<true>} if the current instance is the given instance
 * @throws {Response} if the current instance is not the given instance
 */
export async function ensureInstance(instance: string): Promise<true> {
	const { currentInstance } = await getInstanceInfo()
	if (instance === currentInstance) return true

	throw getReplayResponse(instance)
}

/**
 * Creates a Response object that allows you to replay the request to a different
 * instance by its hostname.
 *
 * NOTE: this uses a redirect request because otherwise, you have to manually
 * forward the headers for document requests in each route that throws this
 * replay response which is easy to forget and a bit of a pain. With a redirect,
 * Remix will simply forward the response as you make it to the browser. And in
 * our case, the response never makes it to the browser because Fly will
 * intercept it due to the fly-replay header.
 *
 * @param instance the instance you want to replay to
 * @returns {Response} the response object you should send for Fly to intercept
 * and replay the request to the given instance.
 * @example
 * import { getReplayResponse } from "litefs-js/remix";
 * // in server-side code ...
 * throw getReplayResponse('some-instance-hostname');
 * ...
 */
export function getReplayResponse(instance: string): Response {
	return new Response(null, {
		status: 302,
		headers: {
			Location: '/',
			'fly-replay': `instance=${instance}`,
		},
	})
}

type ConsistencyResult =
	| { type: 'ok' }
	| { type: 'delete-cookie'; setCookieHeader: string }

/**
 * Ensures that the transactional consistency cookie is set on the response object.
 * If the current instance is the primary instance, then the cookie will be deleted.
 * If the current instance is not the primary instance, then the cookie will be
 * deleted if the transaction number in the cookie is up to date. If the transaction
 * number in the cookie is not up to date, then it will wait for a bit before continuing.
 * If it's still not up-to-date after waiting, then the response will be replayed from
 * the primary instance.
 * @param {Request} request the fetch request object
 * @example
 * import { handleTransactionalConsistency } from "litefs-js/remix";
 * ...
 * const newCookie = await handleTransactionalConsistency(req);
 * if (newCookie) headers.append('Set-Cookie', newCookie);
 * ...
 * @returns {Promise<ConsistencyResult>} - the new cookies value if the tx
 * number needs to be removed.
 * @throws {Response} if the transaction number is not up to date and the
 * response needs to be replayed. Remix will handle this for you, if you catch
 * calls to this function, make sure to re-throw the error if it is an
 * instanceof Response.
 */
export async function handleTransactionalConsistency(
	request: Request,
): Promise<ConsistencyResult> {
	const result = await checkCookieForTransactionalConsistency(
		request.headers.get('Cookie'),
	)
	if (result.type === 'replay') {
		throw getReplayResponse(result.instance)
	}
	if (result.type === 'ok') return { type: 'ok' }
	if (result.type === 'delete-cookie') {
		return { type: 'delete-cookie', setCookieHeader: result.setCookieHeader }
	}
	throw new Error(`Unknown status type ${result}`)
}

/**
 * Appends the transaction number cookie to the response headers if the request
 * is a mutation request if running on the primary instance. Normally this
 * should be used in the entry.server.ts file in both the default export as well as the handleDataRequest export.
 *
 * @param {Request} request the fetch request object
 * @param {Headers} headers the response headers object
 * @example
 *  import { appendTxNumberCookie } from "litefs-js/remix";
 *  ...
 *  export default function handleRequest(request: Request, responseHeaders: Headers) {
 *  	appendTxNumberCookie(request, responseHeaders);
 *  	...
 *  }
 *  ...
 *  export async function handleDataRequest(
 *  	response: Response,
 *  	{ request }: Parameters<HandleDataRequestFunction>[1],
 *  ) {
 *  	// Most of the time, all mutations are finished by now, but just make sure
 *  	// you're finished with all mutations before this line:
 *  	await appendTxNumberCookie(request, response.headers)
 *  	return response
 *  }
 *  ...
 * @returns {Promise<void>}
 */
export async function appendTxNumberCookie(
	request: Request,
	headers: Headers,
): Promise<void> {
	const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE']
	if (mutationMethods.includes(request.method)) {
		const { currentIsPrimary } = await getInstanceInfo()
		if (currentIsPrimary) {
			headers.append('Set-Cookie', getTxSetCookieHeader(await getTxNumber()))
		}
	}
}
