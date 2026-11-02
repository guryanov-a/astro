import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A collection storage driver that writes each snapshot to a JSON file in `dir`. A snapshot
 * file only exists once its writer committed it.
 *
 * @param {{ dir: string }} config
 * @returns {import('astro').CollectionStorageDriver}
 */
export default function createDriver({ dir }) {
	const fileOf = (snapshot) => join(dir, `${snapshot}.json`);
	return {
		async openWriter({ snapshot }) {
			const collections = {};
			return {
				async write(collection, entries) {
					collections[collection] = {};
					for await (const entry of entries) collections[collection][entry.id] = entry;
				},
				async commit() {
					mkdirSync(dir, { recursive: true });
					writeFileSync(fileOf(snapshot), JSON.stringify(collections));
				},
			};
		},
		async openReader({ snapshot }) {
			const file = fileOf(snapshot);
			if (!existsSync(file)) throw new Error(`Snapshot ${snapshot} was never committed`);
			const collections = JSON.parse(readFileSync(file, 'utf-8'));
			const select = (entry, content) =>
				content ? entry : { id: entry.id, metadata: entry.metadata };
			return {
				async get(collection, id, { content }) {
					const entry = collections[collection]?.[id];
					return entry && select(entry, content);
				},
				async *entries(collection, { content }) {
					for (const entry of Object.values(collections[collection] ?? {})) {
						yield select(entry, content);
					}
				},
			};
		},
	};
}
