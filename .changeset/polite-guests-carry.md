---
'@astrojs/collection-storage-sqlite': minor
---

Adds `@astrojs/collection-storage-sqlite`, a collection storage driver that keeps the entries of content collections in a local SQLite file or a remote libSQL database, such as Turso. It requires the experimental `collectionStorageDrivers` flag.

```ts
// src/content.config.ts
import { sqlite } from '@astrojs/collection-storage-sqlite';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/docs' }),
  storage: sqlite({ url: 'libsql://docs-example.turso.io', authTokenEnv: 'DOCS_DATABASE_TOKEN' }),
});
```
