import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const storage = {
	entrypoint: new URL('../json-driver.mjs', import.meta.url),
	config: { dir: new URL('../.astro/json-driver/', import.meta.url).pathname },
};

const docs = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/docs' }),
	schema: z.object({ title: z.string(), author: reference('authors') }),
	storage,
});

const authors = defineCollection({
	loader: file('src/data/authors.json'),
	schema: z.object({ name: z.string() }),
});

export const collections = { docs, authors };
