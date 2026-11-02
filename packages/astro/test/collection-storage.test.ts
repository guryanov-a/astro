import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import * as cheerio from 'cheerio';
import testAdapter from './test-adapter.ts';
import { type App, type DevServer, type Fixture, loadFixture } from './test-utils.ts';

function readFilesRecursively(dir: URL): string {
	return fs
		.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
		.map((entry) => fs.readFileSync(`${entry.parentPath}/${entry.name}`, 'utf-8'))
		.join('\n');
}

describe('Collection storage drivers', () => {
	let fixture: Fixture;
	let app: App;

	before(async () => {
		fixture = await loadFixture({
			root: './fixtures/collection-storage/',
			adapter: testAdapter(),
			outDir: './dist/collection-storage/',
		});
		await fixture.build({});
		app = await fixture.loadTestAdapterApp();
	});

	it('prerenders pages from a stored collection', async () => {
		const $ = cheerio.load(await fixture.readFile('/client/docs/intro/index.html'));

		assert.equal($('#title').text(), 'Introduction');
		assert.equal($('#author').text(), 'Alice');
		assert.equal($('article h1').text(), 'Stored introduction');
		assert.ok(await fixture.readFile('/client/docs/setup/index.html'));
	});

	it('reads stored collections on demand, with and without content', async () => {
		const response = await app.render(new Request('http://example.com/entries.json'));
		assert.equal(response.status, 200);

		assert.deepEqual(await response.json(), {
			ids: ['intro', 'setup'],
			withoutContent: true,
			withContent: true,
			intro: { title: 'Introduction', hasBody: false },
			byReference: ['setup'],
			renderError: 'RenderEntryWithoutContentError',
			missing: null,
		});
	});

	it('does not bundle stored entries with the server', async () => {
		const server = readFilesRecursively(new URL('./server/', fixture.config.outDir));

		assert.doesNotMatch(server, /This paragraph lives in the storage driver/);
		// Bundled collections stay in the server
		assert.match(server, /Alice/);
	});

	it('writes a new snapshot on every build', async () => {
		const driverDir = new URL('./.astro/json-driver/', fixture.config.root);
		const snapshotsBefore = fs.readdirSync(driverDir);

		await fixture.build({});

		const snapshotsAfter = fs.readdirSync(driverDir);
		assert.equal(snapshotsAfter.length, snapshotsBefore.length + 1);
	});
});

describe('Collection storage drivers in development', () => {
	let fixture: Fixture;
	let devServer: DevServer;

	before(async () => {
		fixture = await loadFixture({ root: './fixtures/collection-storage/' });
		devServer = await fixture.startDevServer({});
	});

	after(async () => {
		await devServer?.stop();
		fixture.resetAllFiles();
	});

	async function waitForTitle(path: string, title: string) {
		const deadline = Date.now() + 10_000;
		while (true) {
			const $ = cheerio.load(await (await fixture.fetch(path)).text());
			if ($('#title').text() === title) return $;
			if (Date.now() > deadline) assert.fail(`${path} never showed "${title}"`);
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}

	it('reads stored collections through the driver', async () => {
		const $ = await waitForTitle('/docs/intro', 'Introduction');

		assert.equal($('article h1').text(), 'Stored introduction');
	});

	it('writes a new snapshot when a stored entry changes', async () => {
		const manifestFile = new URL('./.astro/collection-storage.json', fixture.config.root);
		const { snapshot } = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')).drivers[0];

		await fixture.editFile('/src/docs/intro.md', (content) =>
			content.replace('title: Introduction', 'title: Updated introduction'),
		);
		await waitForTitle('/docs/intro', 'Updated introduction');

		const updated = JSON.parse(fs.readFileSync(manifestFile, 'utf-8')).drivers[0];
		assert.notEqual(updated.snapshot, snapshot);
	});
});
