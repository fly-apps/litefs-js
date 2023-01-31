// this is utilities for node's express module
import type { RequestHandler } from 'express'
import { getInstanceInfo } from '.'
import {
	ensurePrimary,
	handleTransactionalConsistency,
	setTxCookie,
} from './http'

export * from './http'

/**
 * This is an express middleware that will ensure that if the client has a
 * transaction number cookie, then the server will wait until the transaction
 * number is up to date before continuing. If it takes too long, then it will
 * instead reply to the primary instance.
 *
 * This should be used in conjunction with the `getSetTxNumberMiddleware` middleware.
 *
 * This should be applied to your app before any database reads or writes.
 * @returns {RequestHandler} the middleware
 */
export function getTransactionalConsistencyMiddleware(): RequestHandler {
	return async (req, res, next) => {
		const replayed = await handleTransactionalConsistency(req, res)
		if (replayed) return
		next()
	}
}

/**
 * This is an express middleware that will set the transaction number cookie on
 * the response object if the current instance is the primary instance.
 *
 * This should be used in conjunction with the `getTransactionalConsistencyMiddleware` middleware.
 *
 * This should be applied to your app after all database reads or writes.
 *
 * @returns {RequestHandler} the middleware
 */
export function getSetTxNumberMiddleware(): RequestHandler {
	const methods = ['POST', 'PUT', 'PATCH', 'DELETE']
	return async (req, res, next) => {
		if (methods.includes(req.method)) {
			const { currentIsPrimary } = await getInstanceInfo()
			if (currentIsPrimary) await setTxCookie(res)
		}
		next()
	}
}

/**
 * This ensures that POST, PUT, PATCH, and DELETE requests are replayed to the
 * primary instance if the current instance is not the primary instance to avoid
 * writing to a non-primary database.
 *
 * @returns {RequestHandler} the middleware
 */
export function getEnsurePrimaryMiddleware(): RequestHandler {
	const methods = ['POST', 'PUT', 'PATCH', 'DELETE']
	return async (req, res, next) => {
		if (methods.includes(req.method)) {
			const replayed = await ensurePrimary(res)
			if (replayed) return
		}
		next()
	}
}
