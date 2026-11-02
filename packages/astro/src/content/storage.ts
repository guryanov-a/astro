import { AstroError, AstroErrorData } from '../core/errors/index.js';

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
