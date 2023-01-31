import os from 'os'
import path from 'path'
import assert from 'node:assert'
import { test, beforeEach, afterEach, after } from 'node:test'
import './utils'
import { getInstanceInfo, getTxNumber } from '../src'
import { tmpdir } from './utils'

test('getInstanceInfo() throws an error if LITEFS_DIR is not defined and no argument is passed', async () => {
	delete process.env.LITEFS_DIR
	assert.rejects(() => getInstanceInfo(), {
		message:
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getInstanceInfo',
	})
})

test('getInstanceInfo() can be passed an argument for the litefsDir', async () => {
	const { primaryInstance, currentIsPrimary } = await getInstanceInfo(
		path.join(tmpdir, 'litefs-dir-arg'),
	)
	// fallsback to the current instance since the .primary doesn't exist
	assert.strictEqual(primaryInstance, os.hostname())
	assert.strictEqual(currentIsPrimary, true)
})

test('getTxNumber() throws an error if LITEFS_DIR is not defined and no argument is passed', async () => {
	delete process.env.LITEFS_DIR
	assert.rejects(() => getTxNumber(), {
		message:
			'litefs-js: LITEFS_DIR is not defined. You must either set the LITEFS_DIR environment variable or pass the litefsDir argument to getTxNumber',
	})
})

test('getTxNumber() throws an error if DATABASE_FILENAME is not defined and no argument is passed', async () => {
	delete process.env.DATABASE_FILENAME
	assert.rejects(() => getTxNumber(), {
		message:
			'litefs-js: DATABASE_FILENAME is not defined. You must either set the DATABASE_FILENAME environment variable or pass the databaseFilename argument to getTxNumber',
	})
})

test('getTxNumber() if there is an error reading the txNumber we default it to 0', async () => {
	const txNumber = await getTxNumber(
		path.join(tmpdir, 'litefs-dir-arg'),
		'database-filename-arg',
	)
	assert.strictEqual(txNumber, 0)
})
