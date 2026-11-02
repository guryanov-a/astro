import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { StoredEntry } from 'astro';
import createDriver from '../dist/driver.js';
import { sqlite } from '../dist/index.js';

function createTestDriver() {
	const dir = mkdtempSync(join(tmpdir(), 'collection-storage-sqlite-'));
	return createDriver({ url: `file:${join(dir, 'collections.db')}` });
}

async function* toAsync(entries: StoredEntry[]) {
	yield* entries;
}

async function collect(entries: AsyncIterable<StoredEntry>) {
	const result: StoredEntry[] = [];
	for await (const entry of entries) result.push(entry);
	return result;
}

const intro: StoredEntry = { id: 'intro', metadata: 'intro-metadata', content: 'intro-content' };
const setup: StoredEntry = { id: 'setup', metadata: 'setup-metadata' };

async function writeSnapshot(
	driver: Awaited<ReturnType<typeof createTestDriver>>,
	snapshot: string,
	collections: Record<string, StoredEntry[]>,
) {
	const writer = await driver.openWriter({ snapshot });
	for (const [collection, entries] of Object.entries(collections)) {
		await writer.write(collection, toAsync(entries));
	}
	await writer.commit();
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
	it('reads the entries of a committed snapshot', async () => {
		const driver = await createTestDriver();
		await writeSnapshot(driver, 'build-1', { docs: [intro, setup] });

		const reader = await driver.openReader({ snapshot: 'build-1' });

		assert.deepEqual(await reader.get('docs', 'intro', { content: true }), intro);
		assert.deepEqual(await reader.get('docs', 'setup', { content: true }), setup);
		assert.equal(await reader.get('docs', 'missing', { content: true }), undefined);
		assert.deepEqual(await collect(reader.entries('docs', { content: true })), [intro, setup]);
		assert.deepEqual(await collect(reader.entries('guides', { content: true })), []);
	});

	it('omits content when it is not requested', async () => {
		const driver = await createTestDriver();
		await writeSnapshot(driver, 'build-1', { docs: [intro] });

		const reader = await driver.openReader({ snapshot: 'build-1' });

		assert.deepEqual(await reader.get('docs', 'intro', { content: false }), {
			id: 'intro',
			metadata: 'intro-metadata',
		});
		assert.deepEqual(await collect(reader.entries('docs', { content: false })), [
			{ id: 'intro', metadata: 'intro-metadata' },
		]);
	});

	it('refuses to read a snapshot before it is committed', async () => {
		const driver = await createTestDriver();
		const writer = await driver.openWriter({ snapshot: 'build-1' });
		await writer.write('docs', toAsync([intro]));

		await assert.rejects(driver.openReader({ snapshot: 'build-1' }), /never committed/);
		await writer.commit();
		await driver.openReader({ snapshot: 'build-1' });
	});

	it('keeps snapshots apart', async () => {
		const driver = await createTestDriver();
		await writeSnapshot(driver, 'build-1', { docs: [intro] });
		await writeSnapshot(driver, 'build-2', { docs: [setup] });

		const first = await driver.openReader({ snapshot: 'build-1' });
		const second = await driver.openReader({ snapshot: 'build-2' });

		assert.deepEqual(await collect(first.entries('docs', { content: true })), [intro]);
		assert.deepEqual(await collect(second.entries('docs', { content: true })), [setup]);
	});

	it('writes and reads collections larger than a page', async () => {
		const driver = await createTestDriver();
		const entries = Array.from({ length: 1234 }, (_, i) => ({
			id: String(i).padStart(4, '0'),
			metadata: `metadata-${i}`,
		}));
		await writeSnapshot(driver, 'build-1', { docs: entries });

		const reader = await driver.openReader({ snapshot: 'build-1' });

		assert.deepEqual(await collect(reader.entries('docs', { content: false })), entries);
	});

	it('throws without a database URL', () => {
		assert.throws(() => createDriver({}), /needs the URL of a database/);
		assert.throws(() => createDriver(undefined), /needs the URL of a database/);
	});
});
