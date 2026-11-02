import * as devalue from 'devalue';
import { AstroError, AstroErrorData } from '../core/errors/index.js';
import type { DataEntry } from './data-store.js';

/**
 * Describes the storage driver that keeps the entries of a build-time collection,
 * passed to the `storage` option of `defineCollection()`.
 *
 * The descriptor is written into the server bundle, so `config` must be JSON-serializable
 * and must not contain secrets.
 */
export interface CollectionStorageDescriptor<
	TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
	/** URL or package specifier of a module whose default export creates the driver. */
	entrypoint: string | URL;
	/** Options passed to the driver factory. Must be JSON-serializable. */
	config?: TConfig;
}

/**
 * The default export of a storage driver's entrypoint. Astro calls it with the `config` of the
 * storage descriptor, once per process that writes or reads the collections using it.
 */
export type CollectionStorageDriverFactory<
	TConfig extends Record<string, unknown> = Record<string, unknown>,
> = (config: TConfig | undefined) => CollectionStorageDriver | Promise<CollectionStorageDriver>;

/**
 * Keeps the entries of build-time collections between sync and runtime.
 *
 * Each build writes its collections to a new snapshot, identified by a snapshot ID, and the
 * server it produces reads only that snapshot. A driver that writes its data inside the build
 * output can ignore the ID; a driver backed by a database shared between deployments must use
 * it to keep snapshots apart.
 */
export interface CollectionStorageDriver {
	/**
	 * Returns the ID of the snapshot a build is about to write, for example a deployment ID.
	 * When omitted, Astro generates a random ID.
	 */
	createSnapshotId?(): string | Promise<string>;
	/** Opens a snapshot for writing. Astro calls it once per snapshot, during sync. */
	openWriter(context: { snapshot: string }): Promise<CollectionStorageWriter>;
	/** Opens a snapshot for reading. Astro only reads a snapshot after its writer committed it. */
	openReader(context: { snapshot: string }): Promise<CollectionStorageReader>;
}

export interface CollectionStorageWriter {
	/**
	 * Writes every entry of a collection. Astro calls it at most once per collection, and waits for
	 * it to resolve before writing the next collection.
	 */
	write(collection: string, entries: AsyncIterable<StoredEntry>): Promise<void>;
	/**
	 * Makes the snapshot readable. A reader must not see any entry of the snapshot before
	 * `commit()` resolves. Astro doesn't call `write()` after `commit()`.
	 */
	commit(): Promise<void>;
}

export interface CollectionStorageReader {
	/**
	 * Returns an entry, or `undefined` when the collection has no entry with this ID.
	 * When `options.content` is `false`, the entry may be returned without its `content`.
	 */
	get(
		collection: string,
		id: string,
		options: { content: boolean },
	): Promise<StoredEntry | undefined>;
	/**
	 * Returns every entry of a collection, in any order. When `options.content` is `false`,
	 * entries may be returned without their `content`.
	 */
	entries(collection: string, options: { content: boolean }): AsyncIterable<StoredEntry>;
}

/**
 * A collection entry as a storage driver keeps it. Astro serializes `metadata` and `content`,
 * and drivers store and return them unchanged.
 */
export interface StoredEntry {
	/** The entry ID, unique in its collection. */
	id: string;
	/** Every field of the entry except `body` and `rendered`. */
	metadata: string;
	/** The entry's `body` and `rendered` fields. Absent when the entry has neither. */
	content?: string;
}

/**
 * Version of the format of {@link StoredEntry.metadata} and {@link StoredEntry.content}.
 * A snapshot is only read by the build that wrote it, so a version mismatch means the snapshot
 * belongs to a different build.
 */
const STORED_ENTRY_FORMAT = 1;

type EntryMetadata = Omit<DataEntry, 'body' | 'rendered'>;
type EntryContent = Pick<DataEntry, 'body' | 'rendered'>;

/** Serializes an entry for a storage driver. {@link deserializeEntry} returns an equal entry. */
export function serializeEntry(entry: DataEntry): StoredEntry {
	const { body, rendered, ...metadata } = entry;
	const stored: StoredEntry = {
		id: entry.id,
		metadata: devalue.stringify([STORED_ENTRY_FORMAT, metadata satisfies EntryMetadata]),
	};
	if (body !== undefined || rendered !== undefined) {
		const content: EntryContent = {};
		if (body !== undefined) content.body = body;
		if (rendered !== undefined) content.rendered = rendered;
		stored.content = devalue.stringify([STORED_ENTRY_FORMAT, content]);
	}
	return stored;
}

/**
 * Deserializes an entry returned by a storage driver. The entry has no `body` or `rendered`
 * fields when `stored` has no `content`.
 *
 * @throws {AstroError} `CollectionStorageFormatMismatch` when the entry was serialized in a
 * different format.
 */
export function deserializeEntry(collection: string, stored: StoredEntry): DataEntry {
	const entry: DataEntry = parseStoredValue<EntryMetadata>(collection, stored.id, stored.metadata);
	if (stored.content !== undefined) {
		const content = parseStoredValue<EntryContent>(collection, stored.id, stored.content);
		if (content.body !== undefined) entry.body = content.body;
		if (content.rendered !== undefined) entry.rendered = content.rendered;
	}
	return entry;
}

function parseStoredValue<T>(collection: string, id: string, value: string): T {
	const parsed = devalue.parse(value);
	if (!Array.isArray(parsed) || parsed[0] !== STORED_ENTRY_FORMAT) {
		throw new AstroError({
			...AstroErrorData.CollectionStorageFormatMismatch,
			message: AstroErrorData.CollectionStorageFormatMismatch.message(collection, id),
		});
	}
	return parsed[1];
}

/**
 * Validates the `storage` option of the collections in a content config.
 *
 * @throws {AstroError} `CollectionStorageDriversNotEnabled` when a collection sets `storage`
 * while `experimental.collectionStorageDrivers` is disabled.
 * @throws {AstroError} `InvalidCollectionStorageConfig` when the `config` of a storage
 * descriptor isn't JSON-serializable.
 */
export function validateCollectionStorage(
	collections: Record<string, { type?: string; storage?: CollectionStorageDescriptor }>,
	enabled: boolean,
): void {
	for (const [name, collection] of Object.entries(collections)) {
		if (!collection.storage) continue;
		if (!enabled) {
			throw new AstroError({
				...AstroErrorData.CollectionStorageDriversNotEnabled,
				message: AstroErrorData.CollectionStorageDriversNotEnabled.message(name),
			});
		}
		const invalidPath = findNonJsonValue(collection.storage.config, 'config');
		if (invalidPath) {
			throw new AstroError({
				...AstroErrorData.InvalidCollectionStorageConfig,
				message: AstroErrorData.InvalidCollectionStorageConfig.message(name, invalidPath),
			});
		}
	}
}

/**
 * Returns the path of the first value that doesn't survive a JSON round trip unchanged,
 * or `undefined` when there is none. Object properties set to `undefined` are allowed,
 * because they are omitted the same way an unset option is.
 */
function findNonJsonValue(value: unknown, path: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	switch (typeof value) {
		case 'string':
		case 'boolean':
			return undefined;
		case 'number':
			return Number.isFinite(value) ? undefined : path;
		case 'object': {
			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					// `undefined` array items become `null`, so they don't round trip
					if (value[i] === undefined) return `${path}[${i}]`;
					const invalid = findNonJsonValue(value[i], `${path}[${i}]`);
					if (invalid) return invalid;
				}
				return undefined;
			}
			const prototype = Object.getPrototypeOf(value);
			if (prototype !== Object.prototype && prototype !== null) return path;
			for (const [key, item] of Object.entries(value)) {
				const invalid = findNonJsonValue(item, `${path}.${key}`);
				if (invalid) return invalid;
			}
			return undefined;
		}
		case 'bigint':
		case 'function':
		case 'symbol':
		case 'undefined':
			return path;
	}
}
