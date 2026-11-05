/**
 * Bulk evacuee volume for one shelter (load/demo testing), e.g.:
 *   pnpm seed:bulk-evacuees --shelter=SH001 --count=100000
 * Without --count it asks for the number in the terminal (default 100000).
 *
 * --shelter is required. Local dev only: refuses a non-local CouchDB. Needs `pnpm seed:master`
 * to have run (reads the vulnerable_group master data, never writes platform data).
 *
 * Adds households, evacuees and movements on top of the staging volume. Ids use the
 * `seed-bulk:` prefix so they never collide with `seed-st:` docs. The run is chunked (about
 * 2,000 people; a chunk is cut at household boundaries so it can be slightly larger) to keep
 * memory flat. Re-running with the same count is a no-op once the LAST evacuee exists; a
 * different count keeps existing docs (conflicts ignored), so unseed first to resize.
 */
import { createInterface } from 'node:readline/promises';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { isLargeVolume, LARGE_VOLUME_WARNING } from './seed/bulk-volume';
import { assertLocalCouch, bulkDocsBatched, couchReq, displayCouchUrl } from './seed/couch';
import { buildPeople, pad } from './seed/people-builder';
import { initStagingFaker } from './seed/people-faker';
import { SH001_CODE, SH002_CODE } from './seed/types';

const ID_PREFIX = 'seed-bulk';
const ZONES = ['Z1', 'Z2', 'Z3', 'Z4'];
const FAKER_SEED = 20261103;
const CHUNK_PERSONS = 2000;
const PAD_WIDTH = 6;
const MAX_COUNT = 999_999; // ids use pad(6)

async function askCount(): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question('จำนวนผู้อพยพที่ต้องการ gen (ค่าเริ่มต้น 100000): ');
		return answer.trim() || '100000';
	} finally {
		rl.close();
	}
}

export function validateCount(raw: string): number {
	const count = Number(raw);
	if (!Number.isInteger(count) || count <= 0 || count > MAX_COUNT) {
		throw new Error(`count must be a positive integer up to ${MAX_COUNT}`);
	}
	return count;
}

/** `count` is null when the caller must ask for it (interactive terminal only). */
export function parseBulkArgs(
	argv: string[],
	isTTY: boolean
): { shelter: string; count: number | null } {
	const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
	const shelter = arg('shelter')?.trim().toUpperCase();
	if (!shelter) throw new Error('--shelter=<code> is required');
	const rawCount = arg('count');
	if (rawCount === undefined) {
		if (!isTTY) throw new Error('pass --count=<n> when not running in a terminal');
		return { shelter, count: null };
	}
	return { shelter, count: validateCount(rawCount) };
}

/** vulnerable_group code by key, read-only from `registry` (seeded by `pnpm seed:master`). */
async function loadVulnerableGroupCodes(): Promise<Set<string>> {
	const { status, data } = await couchReq('GET', '/registry/master_data:vulnerable_group');
	if (status !== 200) {
		throw new Error(
			'registry master_data:vulnerable_group not found — run `pnpm seed:master` first'
		);
	}
	const items = (data as { items?: Array<{ code: string }> }).items ?? [];
	// Seed keys are persisted as the code, so a key is valid exactly when that code exists.
	return new Set(items.map((i) => i.code));
}

async function assertShelterDbExists(db: string): Promise<void> {
	const { status } = await couchReq('GET', `/${db}`);
	if (status !== 200) throw new Error(`shelter DB ${db} not found (HTTP ${status})`);
}

async function alreadySeeded(db: string, id: string): Promise<boolean> {
	const { status } = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	if (status === 200) return true;
	if (status === 404) return false;
	throw new Error(`Cannot probe ${db}/${id} (HTTP ${status})`);
}

async function main(): Promise<void> {
	assertLocalCouch();
	const args = parseBulkArgs(process.argv.slice(2), Boolean(process.stdin.isTTY));
	const { shelter } = args;
	const count = args.count ?? validateCount(await askCount());
	const db = shelterDbName(shelter);
	const codeSlug = shelter.toLowerCase();
	const evIdFor = (i: number) => `${ID_PREFIX}:${codeSlug}:${pad(i, PAD_WIDTH)}`;

	await assertShelterDbExists(db);

	// Chunks are written in order, so the last evacuee existing means the whole run finished.
	if (await alreadySeeded(db, `evacuee:${evIdFor(count - 1)}`)) {
		console.log(`  ✓ ${db}: ${ID_PREFIX} volume for count=${count} already present, skipping`);
		return;
	}

	console.log(`\nAdding ${count} evacuees to ${db} → ${displayCouchUrl()}\n`);
	if (isLargeVolume(count)) console.log(`${LARGE_VOLUME_WARNING}\n`);
	const vgCodes = await loadVulnerableGroupCodes();
	const config = {
		shelterCode: shelter,
		idPrefix: ID_PREFIX,
		padWidth: PAD_WIDTH,
		zones: ZONES,
		faker: initStagingFaker(FAKER_SEED),
		vulnerableGroupCode: (key: string) => {
			if (!vgCodes.has(key))
				throw new Error(`vulnerable_group "${key}" missing — run \`pnpm seed:master\``);
			return key;
		},
		transferDestCode: shelter === SH002_CODE ? SH001_CODE : SH002_CODE,
		allowPets: true
	};

	let cursor = { personIndex: 0, householdIndex: 0 };
	while (cursor.personIndex < count) {
		const chunkEnd = Math.min(count, cursor.personIndex + CHUNK_PERSONS);
		const { docs, ...next } = buildPeople(config, cursor, chunkEnd, count);
		cursor = next;

		// Resume after a failed run: a chunk whose last evacuee exists was already written.
		if (await alreadySeeded(db, `evacuee:${evIdFor(cursor.personIndex - 1)}`)) {
			console.log(`  ✓ ${cursor.personIndex}/${count} already written, skipping chunk`);
			continue;
		}

		await bulkDocsBatched(db, docs, 150, { allowConflicts: true });
		console.log(`  ✓ ${cursor.personIndex}/${count} evacuees written`);
	}

	console.log(`\n  ✓ ${db}: ${count} bulk evacuees, ${cursor.householdIndex} households\n`);
}

if (process.argv[1]?.endsWith('seed-bulk-evacuees.ts')) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
