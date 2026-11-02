import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createStorageDriverTests } from 'astro/content/storage-driver-tests';
import createDriver from '../dist/driver.js';
import { sqlite } from '../dist/index.js';

function createTestDriver() {
	const dir = mkdtempSync(join(tmpdir(), 'collection-storage-sqlite-'));
	return createDriver({ url: `file:${join(dir, 'collections.db')}` });
}

describe('sqlite()', () => {
	it('returns a storage descriptor for the driver', () => {
		assert.deepEqual(sqlite({ url: 'libsql://example.turso.io', authTokenEnv: 'TOKEN' }), {
			entrypoint: '@astrojs/collection-storage-sqlite/driver',
			config: { url: 'libsql://example.turso.io', authTokenEnv: 'TOKEN' },
		});
	});
});

describe('SQLite collection storage driver', () => {
	for (const test of createStorageDriverTests(createTestDriver)) {
		it(test.name, test.run);
	}

	it('refuses to open a snapshot before it is committed', async () => {
		const driver = await createTestDriver();
		const writer = await driver.openWriter({ snapshot: 'build-1' });

		await assert.rejects(driver.openReader({ snapshot: 'build-1' }), /never committed/);
		await writer.commit();
		await driver.openReader({ snapshot: 'build-1' });
	});

	it('throws without a database URL', () => {
		assert.throws(() => createDriver({}), /needs the URL of a database/);
		assert.throws(() => createDriver(undefined), /needs the URL of a database/);
	});
});
