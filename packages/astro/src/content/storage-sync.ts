import { randomUUID } from 'node:crypto';
import type fsMod from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RunnableDevEnvironment } from 'vite';
import { AstroError, AstroErrorData } from '../core/errors/index.js';
import { STORED_COLLECTIONS_FILE } from './consts.js';
import type { DataEntry } from './data-store.js';
import {
	type CollectionStorageDescriptor,
	type CollectionStorageDriver,
	serializeEntry,
	type StoredEntry,
} from './storage.js';

/**
 * Describes where the collections with a storage driver were written by the last sync. Sync
 * writes it to a file in the `.astro` directory, and the build reads it to bundle the drivers
 * and the snapshot each one must read.
 */
export interface StoredCollectionsManifest {
	drivers: Array<{
		/** Package specifier or file URL `href` of the driver's entrypoint. */
		entrypoint: string;
		config?: Record<string, unknown>;
		snapshot: string;
		collections: string[];
	}>;
}

/** Reads the manifest written by the last sync, or returns `undefined` when there is none. */
export function readStoredCollectionsManifest(
	fs: typeof fsMod,
	dotAstroDir: URL,
): StoredCollectionsManifest | undefined {
	const file = new URL(STORED_COLLECTIONS_FILE, dotAstroDir);
	if (!fs.existsSync(file)) return undefined;
	return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export type LoadCollectionStorageDriver = (
	descriptor: CollectionStorageDescriptor,
) => Promise<CollectionStorageDriver>;

/**
 * Returns a function that creates the driver of a storage descriptor by importing its
 * entrypoint in a Vite environment. Drivers are created once per descriptor and reused, as
 * each sync in development writes to the same drivers.
 */
export function createDriverLoader(
	environment: RunnableDevEnvironment,
): LoadCollectionStorageDriver {
	const drivers = new Map<string, Promise<CollectionStorageDriver>>();
	return (descriptor) => {
		const key = getDescriptorKey(descriptor);
		let driver = drivers.get(key);
		if (!driver) {
			driver = importDriver(environment, descriptor);
			drivers.set(key, driver);
			// Retry on the next sync instead of caching the failure
			driver.catch(() => drivers.delete(key));
		}
		return driver;
	};
}

async function importDriver(
	environment: RunnableDevEnvironment,
	{ entrypoint, config }: CollectionStorageDescriptor,
): Promise<CollectionStorageDriver> {
	const specifier = getEntrypointSpecifier(entrypoint);
	const invalid = (reason: string, cause?: unknown) =>
		new AstroError(
			{
				...AstroErrorData.InvalidCollectionStorageDriver,
				message: AstroErrorData.InvalidCollectionStorageDriver.message(specifier, reason),
			},
			{ cause },
		);

	let module: { default?: unknown };
	try {
		module = await environment.runner.import(
			specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier,
		);
	} catch (cause) {
		throw invalid('Its entrypoint could not be imported.', cause);
	}
	if (typeof module.default !== 'function') {
		throw invalid('Its entrypoint must default-export a function that creates the driver.');
	}
	const driver = await module.default(config);
	if (typeof driver?.openWriter !== 'function' || typeof driver?.openReader !== 'function') {
		throw invalid('The driver must implement `openWriter()` and `openReader()`.');
	}
	return driver;
}

/**
 * Writes the collections that have a storage driver to a new snapshot of their driver, and
 * returns where they were written. Collections sharing a storage descriptor share a driver
 * and a snapshot.
 */
export async function writeStoredCollections({
	collections,
	readEntries,
	loadDriver,
}: {
	/** The storage descriptor of each collection that has one. */
	collections: Map<string, CollectionStorageDescriptor>;
	readEntries: (collection: string) => Iterable<DataEntry>;
	loadDriver: LoadCollectionStorageDriver;
}): Promise<StoredCollectionsManifest> {
	const groups = new Map<string, { descriptor: CollectionStorageDescriptor; names: string[] }>();
	for (const [name, descriptor] of collections) {
		const key = getDescriptorKey(descriptor);
		const group = groups.get(key) ?? { descriptor, names: [] };
		group.names.push(name);
		groups.set(key, group);
	}

	const manifest: StoredCollectionsManifest = { drivers: [] };
	for (const { descriptor, names } of groups.values()) {
		const driver = await loadDriver(descriptor);
		const snapshot = (await driver.createSnapshotId?.()) ?? randomUUID();
		if (typeof snapshot !== 'string' || snapshot === '') {
			throw new AstroError({
				...AstroErrorData.InvalidCollectionStorageDriver,
				message: AstroErrorData.InvalidCollectionStorageDriver.message(
					getEntrypointSpecifier(descriptor.entrypoint),
					'`createSnapshotId()` must return a non-empty string.',
				),
			});
		}
		const writer = await driver.openWriter({ snapshot });
		for (const name of names) {
			await writer.write(name, toStoredEntries(readEntries(name)));
		}
		await writer.commit();
		manifest.drivers.push({
			entrypoint: getEntrypointSpecifier(descriptor.entrypoint),
			config: descriptor.config,
			snapshot,
			collections: names,
		});
	}
	return manifest;
}

async function* toStoredEntries(entries: Iterable<DataEntry>): AsyncIterable<StoredEntry> {
	for (const entry of entries) {
		yield serializeEntry(entry);
	}
}

function getEntrypointSpecifier(entrypoint: string | URL): string {
	return entrypoint instanceof URL ? entrypoint.href : entrypoint;
}

function getDescriptorKey({ entrypoint, config }: CollectionStorageDescriptor): string {
	return JSON.stringify([getEntrypointSpecifier(entrypoint), config ?? null]);
}
