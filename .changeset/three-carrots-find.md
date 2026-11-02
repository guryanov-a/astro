---
'astro': minor
---

Adds experimental support for keeping build-time content collections in a storage driver, such as a SQLite database, instead of the data store bundled with your site

By default, every content collection is bundled with your site, and the first call to `getCollection()` or `getEntry()` loads all of them in memory. With the new `experimental.collectionStorageDrivers` flag, you can choose collections whose entries are kept by a storage driver and read one at a time instead:

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
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { sqlite } from '@astrojs/collection-storage-sqlite';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/docs' }),
  storage: sqlite({ url: 'libsql://docs-example.turso.io', authTokenEnv: 'DOCS_DATABASE_TOKEN' }),
});

export const collections = { docs };
```

Collections without `storage` stay bundled with your site, and existing loaders work with any storage. Each build writes its collections to a new snapshot, and the server it produces only reads that snapshot.

`getCollection()`, `getEntry()` and `getEntries()` also accept a `content` option. With `{ content: false }`, entries are returned without `body` and `rendered`, so a driver doesn't need to load their content, for example when listing the pages of a collection in `getStaticPaths()`:

```astro
---
import { getCollection, getEntry, render } from 'astro:content';

export async function getStaticPaths() {
  const docs = await getCollection('docs', undefined, { content: false });
  return docs.map((doc) => ({ params: { id: doc.id } }));
}

const entry = await getEntry('docs', Astro.params.id);
const { Content } = await render(entry);
---

<Content />
```

Entries read with `{ content: false }` can't be passed to `render()`.

To write your own driver, create a module whose default export returns a `CollectionStorageDriver`, and pass its path or package name as the `entrypoint` of the descriptor you pass to `storage`. Use `createStorageDriverTests()` from `astro/content/storage-driver-tests` to check that your driver behaves as Astro expects.
