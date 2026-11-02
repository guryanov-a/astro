import type { CollectionStorageDriver, StoredEntry } from './storage.js';

export interface StorageDriverTest {
	name: string;
	run: () => Promise<void>;
}

/**
 * Returns the tests a collection storage driver must pass, independent of any test runner.
 * `createDriver` is called once per test and must return a driver with no snapshots.
 *
 * ```ts
 * import { describe, it } from 'node:test';
 * import { createStorageDriverTests } from 'astro/content/storage-driver-tests';
 *
 * describe('my driver', () => {
 *   for (const test of createStorageDriverTests(() => createDriver(config))) {
 *     it(test.name, test.run);
 *   }
 * });
 * ```
 */
export function createStorageDriverTests(
	createDriver: () => CollectionStorageDriver | Promise<CollectionStorageDriver>,
): StorageDriverTest[] {
	const intro: StoredEntry = { id: 'intro', metadata: 'intro-metadata', content: 'intro-content' };
	const setup: StoredEntry = { id: 'setup', metadata: 'setup-metadata' };

	return [
		{
			name: 'reads the entries written to a committed snapshot',
			async run() {
				const driver = await createDriver();
				await writeSnapshot(driver, 'snapshot-1', { docs: [intro, setup] });
				const reader = await driver.openReader({ snapshot: 'snapshot-1' });

				assertEqual(await reader.get('docs', 'intro', { content: true }), intro, 'get()');
				assertEqual(await reader.get('docs', 'setup', { content: true }), setup, 'get()');
				assertEqual(
					sortById(await collect(reader.entries('docs', { content: true }))),
					[intro, setup],
					'entries()',
				);
			},
		},
		{
			name: 'returns nothing for missing entries and collections',
			async run() {
				const driver = await createDriver();
				await writeSnapshot(driver, 'snapshot-1', { docs: [intro] });
				const reader = await driver.openReader({ snapshot: 'snapshot-1' });

				assertEqual(await reader.get('docs', 'missing', { content: true }), undefined, 'get()');
				assertEqual(await reader.get('guides', 'intro', { content: true }), undefined, 'get()');
				assertEqual(await collect(reader.entries('guides', { content: true })), [], 'entries()');
			},
		},
		{
			name: 'keeps collections of a snapshot apart',
			async run() {
				const driver = await createDriver();
				await writeSnapshot(driver, 'snapshot-1', { docs: [intro], guides: [setup] });
				const reader = await driver.openReader({ snapshot: 'snapshot-1' });

				assertEqual(await collect(reader.entries('docs', { content: true })), [intro], 'docs');
				assertEqual(await collect(reader.entries('guides', { content: true })), [setup], 'guides');
			},
		},
		{
			name: 'keeps snapshots apart',
			async run() {
				const driver = await createDriver();
				await writeSnapshot(driver, 'snapshot-1', { docs: [intro] });
				await writeSnapshot(driver, 'snapshot-2', { docs: [setup] });
				const first = await driver.openReader({ snapshot: 'snapshot-1' });
				const second = await driver.openReader({ snapshot: 'snapshot-2' });

				assertEqual(await collect(first.entries('docs', { content: true })), [intro], 'first');
				assertEqual(await collect(second.entries('docs', { content: true })), [setup], 'second');
			},
		},
		{
			name: 'does not show entries of a snapshot before it is committed',
			async run() {
				const driver = await createDriver();
				const writer = await driver.openWriter({ snapshot: 'snapshot-1' });
				await writer.write('docs', toAsyncIterable([intro]));

				let entry: StoredEntry | undefined;
				try {
					const reader = await driver.openReader({ snapshot: 'snapshot-1' });
					entry = await reader.get('docs', 'intro', { content: true });
				} catch {
					// Refusing to open an uncommitted snapshot is allowed
				}
				assertEqual(entry, undefined, 'entry of an uncommitted snapshot');
			},
		},
		{
			name: 'returns entries without content when it is not requested',
			async run() {
				const driver = await createDriver();
				await writeSnapshot(driver, 'snapshot-1', { docs: [intro] });
				const reader = await driver.openReader({ snapshot: 'snapshot-1' });
				const withoutContent = { id: intro.id, metadata: intro.metadata };

				const entry = await reader.get('docs', 'intro', { content: false });
				assertEqual({ id: entry?.id, metadata: entry?.metadata }, withoutContent, 'get()');
				const [listed] = await collect(reader.entries('docs', { content: false }));
				assertEqual({ id: listed?.id, metadata: listed?.metadata }, withoutContent, 'entries()');
			},
		},
		{
			name: 'stores entries larger than a page of results',
			async run() {
				const driver = await createDriver();
				const entries = Array.from({ length: 1234 }, (_, i) => ({
					id: String(i).padStart(4, '0'),
					metadata: `metadata-${i}`,
				}));
				await writeSnapshot(driver, 'snapshot-1', { docs: entries });
				const reader = await driver.openReader({ snapshot: 'snapshot-1' });

				assertEqual(
					sortById(await collect(reader.entries('docs', { content: false }))),
					entries,
					'entries()',
				);
			},
		},
	];
}

async function writeSnapshot(
	driver: CollectionStorageDriver,
	snapshot: string,
	collections: Record<string, StoredEntry[]>,
) {
	const writer = await driver.openWriter({ snapshot });
	for (const [collection, entries] of Object.entries(collections)) {
		await writer.write(collection, toAsyncIterable(entries));
	}
	await writer.commit();
}

async function* toAsyncIterable(entries: StoredEntry[]): AsyncIterable<StoredEntry> {
	yield* entries;
}

async function collect(entries: AsyncIterable<StoredEntry>): Promise<StoredEntry[]> {
	const result: StoredEntry[] = [];
	for await (const entry of entries) result.push(entry);
	return result;
}

function sortById(entries: StoredEntry[]): StoredEntry[] {
	return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Compares entries by their fields, whatever order a driver returns the fields in. */
function assertEqual(actual: unknown, expected: unknown, label: string) {
	const actualJson = JSON.stringify(normalize(actual));
	const expectedJson = JSON.stringify(normalize(expected));
	if (actualJson !== expectedJson) {
		throw new Error(`${label}: expected ${expectedJson}, received ${actualJson}`);
	}
}

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === 'object') {
		const { id, metadata, content } = value as Partial<StoredEntry>;
		return [id, metadata, content ?? null];
	}
	return value ?? null;
}
