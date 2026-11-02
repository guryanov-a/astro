import { createClient } from '@libsql/client/web';
import type { CollectionStorageDriverFactory } from 'astro';
import { createSqliteDriver } from './create-driver.js';

// Runtimes without native modules, such as Cloudflare Workers, can only reach remote databases
const createDriver: CollectionStorageDriverFactory = (config) =>
	createSqliteDriver(createClient, config);

export default createDriver;
