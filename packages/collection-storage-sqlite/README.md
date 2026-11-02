# @astrojs/collection-storage-sqlite

Keeps the entries of Astro content collections in a SQLite or [libSQL](https://github.com/tursodatabase/libsql) database, such as a local file or a remote [Turso](https://turso.tech) database, instead of the data store bundled with your site.

This package requires the experimental `collectionStorageDrivers` flag.

## Usage

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';

export default defineConfig({
  experimental: {
    collectionStorageDrivers: true,
  },
});
```

```ts
// src/content.config.ts
import { sqlite } from '@astrojs/collection-storage-sqlite';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/docs' }),
  storage: sqlite({
    url: 'libsql://docs-example.turso.io',
    authTokenEnv: 'DOCS_DATABASE_TOKEN',
  }),
});

export const collections = { docs };
```

## Options

### `url`

The URL of the database: `file:` followed by a path for a local SQLite file, or the `libsql://` or `https://` URL of a remote database. Relative paths start from the directory where Astro runs.

### `authTokenEnv`

The name of the environment variable that holds the auth token of a remote database. The driver reads the variable when it starts, at build time and at runtime, so the token is never written into your build.

## Snapshots

Each build writes its collections to a new snapshot, and the server it produces only reads that snapshot. Snapshots of every build stay in the database: delete old rows from the `astro_collection_entries` and `astro_collection_snapshots` tables to reclaim space.

Runtimes without native modules, such as Cloudflare Workers, can only use remote databases.
