/**
 * Read-only runtime verification for the CR-042 daily_calc seed.
 *
 * Usage: pnpm verify:resource-calc-seed
 *
 * This script never writes to CouchDB. It verifies the persisted master, registry, ledger, and
 * daily_calc snapshots against the same public/pure contracts used by the application.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStockLedger, stockBalance } from '$lib/features/operations/domain/operations';
import {
	SOP_RATIO_KEYS,
	SOP_RATIO_KIND,
	sopMasterSchema
} from '$lib/features/sop-ratios/domain/sop-ratio';
import {
	calculateResources,
	FORMULA_V,
	type ResourceInput
} from '$lib/features/resource-calc/domain/calc.formula';
import {
	parseDailyCalcRecord,
	resolveHave,
	type ShelterHaveSource
} from '$lib/features/resource-calc/core';
import { inspectDateWindow, prefixRangeEnd } from './t31-seed-support';

const SHELTER_CODE = 'SH001';
const SHELTER_DB = 'shelter_sh001';
const DAILY_CALC_DAYS = 14;
const COUCH_TIMEOUT_MS = 5_000;

function loadEnv(): Record<string, string> {
	const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
	if (!existsSync(envPath)) return {};
	return Object.fromEntries(
		readFileSync(envPath, 'utf8')
			.split('\n')
			.filter((line) => line.trim() && !line.trim().startsWith('#') && line.includes('='))
			.map((line) => {
				const separator = line.indexOf('=');
				return [
					line.slice(0, separator).trim(),
					line
						.slice(separator + 1)
						.trim()
						.replace(/^['"]|['"]$/g, '')
				];
			})
	);
}

function couchConnection(): { baseUrl: string; authHeader: string } {
	const env = loadEnv();
	const raw =
		process.env.COUCHDB_ADMIN_URL ??
		env.COUCHDB_ADMIN_URL ??
		'http://admin:password@localhost:5984';
	const url = new URL(raw);
	const credentials = Buffer.from(
		`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
	).toString('base64');
	url.username = '';
	url.password = '';
	return { baseUrl: url.toString().replace(/\/$/, ''), authHeader: `Basic ${credentials}` };
}

async function couchGet(path: string): Promise<unknown> {
	const { baseUrl, authHeader } = couchConnection();
	let response: Response;
	try {
		response = await fetch(`${baseUrl}${path}`, {
			headers: { authorization: authHeader },
			signal: AbortSignal.timeout(COUCH_TIMEOUT_MS)
		});
	} catch (error) {
		throw new Error(
			`CouchDB GET ${path} was unavailable within ${COUCH_TIMEOUT_MS}ms: ${String(error)}`,
			{ cause: error }
		);
	}
	const text = await response.text();
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`CouchDB returned non-JSON for ${path}: HTTP ${response.status}`);
	}
	if (!response.ok) throw new Error(`CouchDB GET ${path} failed: HTTP ${response.status}`);
	return data;
}

function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function expectedSeedDates(): string[] {
	const today = new Date();
	return Array.from({ length: DAILY_CALC_DAYS }, (_, index) => {
		const date = new Date(today);
		date.setDate(date.getDate() - (DAILY_CALC_DAYS - 1 - index));
		return isoDay(date);
	});
}

function docsFrom(data: unknown): unknown[] {
	if (!data || typeof data !== 'object' || !Array.isArray((data as { rows?: unknown[] }).rows)) {
		throw new Error('CouchDB response did not contain rows');
	}
	return (data as { rows: Array<{ doc?: unknown }> }).rows
		.map((row) => row.doc)
		.filter((doc): doc is unknown => doc !== undefined);
}

async function readByPrefix(db: string, prefix: string): Promise<unknown[]> {
	const startkey = encodeURIComponent(JSON.stringify(prefix));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd(prefix)));
	return docsFrom(
		await couchGet(`/${db}/_all_docs?include_docs=true&startkey=${startkey}&endkey=${endkey}`)
	);
}

async function main(): Promise<void> {
	const [dailyDocs, ledgerDocs, registryDocs, masterRaw] = await Promise.all([
		readByPrefix(SHELTER_DB, 'daily_calc:'),
		readByPrefix(SHELTER_DB, 'stock_ledger:'),
		couchGet('/registry/_all_docs?include_docs=true').then(docsFrom),
		couchGet('/catalog/sop_profile%3Amaster_sphere_baseline')
	]);

	const master = sopMasterSchema.parse(masterRaw);
	assert.equal(master.active, true, 'persisted master SOP profile must be active');

	const registryShelter = registryDocs.find(
		(doc): doc is Record<string, unknown> =>
			!!doc &&
			typeof doc === 'object' &&
			(doc as Record<string, unknown>).type === 'shelter' &&
			(doc as Record<string, unknown>).code === SHELTER_CODE
	);
	assert.ok(registryShelter, `missing registry shelter ${SHELTER_CODE}`);
	const rawFacilities =
		registryShelter.facilities && typeof registryShelter.facilities === 'object'
			? (registryShelter.facilities as Record<string, unknown>)
			: {};
	const shelter: ShelterHaveSource = {
		area_m2: typeof registryShelter.area_m2 === 'number' ? registryShelter.area_m2 : null,
		facilities: {
			water_points:
				typeof rawFacilities.water_points === 'number' ? rawFacilities.water_points : null,
			showers: typeof rawFacilities.showers === 'number' ? rawFacilities.showers : null,
			toilets_female:
				typeof rawFacilities.toilets_female === 'number' ? rawFacilities.toilets_female : null,
			toilets_male:
				typeof rawFacilities.toilets_male === 'number' ? rawFacilities.toilets_male : null
		}
	};

	const ledger = ledgerDocs.map((doc, index) => {
		try {
			return parseStockLedger(doc);
		} catch (error) {
			throw new Error(`Invalid persisted stock_ledger at row ${index}: ${String(error)}`, {
				cause: error
			});
		}
	});
	const stock = stockBalance(ledger);
	const expectedDates = expectedSeedDates();
	const records = dailyDocs.map((doc) => parseDailyCalcRecord(doc));
	const recordsByDate = new Map(
		records.map((record) => [record._id.slice('daily_calc:'.length), record])
	);

	const { missingDates, extraDates } = inspectDateWindow(recordsByDate.keys(), expectedDates);
	assert.deepEqual(missingDates, [], 'seed dates must contain every consecutive date D-13..D');
	if (extraDates.length) {
		console.warn(`Ignoring ${extraDates.length} daily_calc snapshot(s) outside D-13..D`);
	}

	for (const date of expectedDates) {
		const record = recordsByDate.get(date);
		assert.ok(record, `missing daily_calc:${date}`);
		assert.equal(record.shelter_code, SHELTER_CODE);
		assert.equal(record.formula_v, FORMULA_V);
		assert.equal(record.ratio_source, 'master');
		assert.equal(record.sop_override_id, null);
		assert.equal(record.sop_override_version, null);
		assert.deepEqual(record.ratio_snapshot, master.ratios);

		const resources: ResourceInput[] = SOP_RATIO_KEYS.map((key) => ({
			key,
			kind: SOP_RATIO_KIND[key],
			ratio: master.ratios[key],
			have: resolveHave(key, { stock, shelter })
		}));
		const expectedResults = calculateResources({
			occupancy: record.occupancy_snapshot,
			as_of: record.as_of,
			resources
		});
		assert.deepEqual(record.results, expectedResults, `formula output mismatch for ${record._id}`);
		assert.deepEqual(
			record.stock_snapshot,
			Object.fromEntries(resources.map((resource) => [resource.key, resource.have])),
			`have-map mismatch for ${record._id}`
		);
	}

	console.log(`Verified ${expectedDates.length} consecutive ${SHELTER_DB} daily_calc snapshots`);
	console.log(
		`Verified canonical ${SOP_RATIO_KEYS.length}-key master snapshot and CR-042 have-map`
	);
	console.log(
		`Verified signed stock balance for item:water = ${stock.get('item:water') ?? '<missing>'}`
	);
}

main().catch((error: unknown) => {
	console.error(
		`T-31 seed verification failed: ${error instanceof Error ? error.message : String(error)}`
	);
	process.exitCode = 1;
});
