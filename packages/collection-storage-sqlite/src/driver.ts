import { createClient } from '@libsql/client';
import type { CollectionStorageDriverFactory } from 'astro';
import { createSqliteDriver } from './create-driver.js';

const createDriver: CollectionStorageDriverFactory = (config) =>
	createSqliteDriver(createClient, config);

export default createDriver;
