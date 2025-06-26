import os from 'os'
import path from 'path'
import assert from 'node:assert'
import { test } from 'node:test'
import './utils'
import { getInstanceInfo, getTxNumber, getInstanceInfoSync } from '../src'
import { tmpdir } from './utils'
import fs from 'fs'

await test('getInstanceInfo() throws an error if LITEFS_DIR is not defined and no argument is passed', async () => {
	delete process.env.LITEFS_DIR
	assert.rejects(() => getInstanceInfo(), {
		message:
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getInstanceInfo',
	})
})

await test('getInstanceInfo() can be passed an argument for the litefsDir', async () => {
	const { primaryInstance, currentIsPrimary } = await getInstanceInfo(
		path.join(tmpdir, 'litefs-dir-arg'),
	)
	// fallsback to the current instance since the .primary doesn't exist
	assert.strictEqual(primaryInstance, os.hostname())
	assert.strictEqual(currentIsPrimary, true)
})

await test('getTxNumber() throws an error if LITEFS_DIR is not defined and no argument is passed', async () => {
	delete process.env.LITEFS_DIR
	assert.rejects(() => getTxNumber(), {
		message:
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getTxNumber',
	})
})

await test('getTxNumber() throws an error if DATABASE_FILENAME is not defined and no argument is passed', async () => {
	delete process.env.DATABASE_FILENAME
	assert.rejects(() => getTxNumber(), {
		message:
			'litefs-js: DATABASE_FILENAME is not defined. You must either set the DATABASE_FILENAME environment variable or pass the databaseFilename argument to getTxNumber',
	})
})

await test('getTxNumber() if there is an error reading the txNumber we default it to 0', async () => {
	const txNumber = await getTxNumber(
		path.join(tmpdir, 'litefs-dir-arg'),
		'database-filename-arg',
	)
	assert.strictEqual(txNumber, 0)
})

await test('getInstanceInfoSync() throws an error if LITEFS_DIR is not defined and no argument is passed', () => {
	delete process.env.LITEFS_DIR
	assert.throws(() => getInstanceInfoSync(), {
		message:
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getInstanceInfo',
	})
})

await test('getInstanceInfoSync() can be passed an argument for the litefsDir (no .primary file)', () => {
	const litefsDir = path.join(tmpdir, 'litefs-dir-arg-sync')
	fs.mkdirSync(litefsDir, { recursive: true })
	const { primaryInstance, currentInstance, currentIsPrimary } =
		getInstanceInfoSync(litefsDir)
	assert.strictEqual(primaryInstance, os.hostname())
	assert.strictEqual(currentInstance, os.hostname())
	assert.strictEqual(currentIsPrimary, true)
})

await test('getInstanceInfoSync() returns current as primary if .primary file contains current hostname', () => {
	const litefsDir = path.join(tmpdir, 'litefs-dir-primary-sync')
	fs.mkdirSync(litefsDir, { recursive: true })
	fs.writeFileSync(path.join(litefsDir, '.primary'), os.hostname())
	const { primaryInstance, currentInstance, currentIsPrimary } =
		getInstanceInfoSync(litefsDir)
	assert.strictEqual(primaryInstance, os.hostname())
	assert.strictEqual(currentInstance, os.hostname())
	assert.strictEqual(currentIsPrimary, true)
})

await test('getInstanceInfoSync() returns replica info if .primary file contains different hostname', () => {
	const litefsDir = path.join(tmpdir, 'litefs-dir-replica-sync')
	fs.mkdirSync(litefsDir, { recursive: true })
	const fakePrimary = 'otherhost-sync'
	fs.writeFileSync(path.join(litefsDir, '.primary'), fakePrimary)
	const { primaryInstance, currentInstance, currentIsPrimary } =
		getInstanceInfoSync(litefsDir)
	assert.strictEqual(primaryInstance, fakePrimary)
	assert.strictEqual(currentInstance, os.hostname())
	assert.strictEqual(currentIsPrimary, false)
})
