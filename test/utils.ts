import { fetch } from '@remix-run/web-fetch'
import express from 'express'
import fs from 'fs'
import type http from 'http'
import { after, afterEach, beforeEach } from 'node:test'
import os from 'os'

const {
	LITEFS_DIR: original_LITEFS_DIR,
	DATABASE_FILENAME: original_DATABASE_FILENAME,
} = process.env

export const tmpdir = `${os.tmpdir()}/litefs-js-test`

beforeEach(async () => {
	process.env.LITEFS_DIR = tmpdir
	process.env.DATABASE_FILENAME = 'test.db'
	await fs.promises.mkdir(tmpdir, { recursive: true })
})

afterEach(async () => {
	process.env.LITEFS_DIR = original_LITEFS_DIR
	process.env.DATABASE_FILENAME = original_DATABASE_FILENAME
	await fs.promises.rm(tmpdir, { recursive: true })
})

const servers = new Set<http.Server>()
const serversClosing = new Map<http.Server, Promise<unknown>>()

afterEach(() => {
	const runningServers = Array.from(servers).filter(s => !serversClosing.has(s))
	for (const server of runningServers) {
		serversClosing.set(
			server,
			new Promise((resolve, reject) => {
				server.close(err => {
					if (err) reject(err)
					else resolve(0)
				})
			}),
		)
	}
})

after(async () => {
	await Promise.all(Array.from(serversClosing))
})

export const sleep = (ms: number) =>
	new Promise(resolve => setTimeout(resolve, ms))

export async function waitFor<ReturnValue>(
	cb: () => ReturnValue | Promise<ReturnValue>,
	{ timeout: timeout = 1000 } = {},
): Promise<NonNullable<ReturnValue>> {
	const end = Date.now() + timeout
	let lastError
	do {
		await sleep(10)
		try {
			const result = await cb()
			if (result != null) {
				return result
			} else {
				throw new Error(`Callback returned ${result}`)
			}
		} catch (error) {
			lastError = error
		}
	} while (Date.now() < end)
	throw lastError
}

export async function createServer() {
	const app = express()
	const server = app.listen()
	const port = await waitFor(() => (server.address() as any).port)
	servers.add(server)
	return {
		app,
		fetch: (pathname: string, options?: RequestInit) => {
			return fetch(`http://localhost:${port}${pathname}`, options)
		},
	}
}

export async function setupPrimary() {
	await fs.promises.writeFile(
		`${process.env.LITEFS_DIR}/.primary`,
		os.hostname(),
	)
}

export async function setupReplica() {
	const primary = 'otherhost'
	await fs.promises.writeFile(`${process.env.LITEFS_DIR}/.primary`, primary)
	return primary
}

export async function setupTxNumber(txnum: number = 0) {
	await fs.promises.writeFile(
		`${process.env.LITEFS_DIR}/${process.env.DATABASE_FILENAME}-pos`,
		`${txnum.toString(16)}/${(0.0).toString(16)}`,
	)
}
