/**
 * Staging volume people: ~1,000 evacuees across SH001–SH003 with Thai faker names.
 */
import { shelterDbName } from '$lib/server/shelter-access-design';
import type { PeopleDoc } from '$lib/features/people/domain/people';
import { prefixRangeEnd } from '../t31-seed-support';
import { bulkDocsBatched, couchReq } from './couch';
import { initStagingFaker } from './people-faker';
import { buildPeople } from './people-builder';
import {
	masterCodes,
	SH001_CODE,
	SH002_CODE,
	SH003_CODE,
	STAGING_VOLUME,
	type MasterLookup
} from './types';

type ShelterVolume = {
	code: string;
	count: number;
	zones: string[];
};

const SHELTER_VOLUMES: ShelterVolume[] = [
	{ code: SH001_CODE, count: STAGING_VOLUME.SH001, zones: ['Z1', 'Z2', 'Z3', 'Z4'] },
	{ code: SH002_CODE, count: STAGING_VOLUME.SH002, zones: ['Z1', 'Z2'] },
	{ code: SH003_CODE, count: STAGING_VOLUME.SH003, zones: ['Z1', 'Z2'] }
];

async function alreadySeeded(db: string): Promise<boolean> {
	const prefix = 'evacuee:seed-st:';
	const startkey = encodeURIComponent(JSON.stringify(prefix));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd(prefix)));
	const { status, data } = await couchReq(
		'GET',
		`/${db}/_all_docs?startkey=${startkey}&endkey=${endkey}&limit=5`
	);
	if (status !== 200) return false;
	const rows = (data as { rows?: unknown[] }).rows ?? [];
	return rows.length > 0;
}

function buildShelterPeople(
	master: MasterLookup,
	shelter: ShelterVolume,
	faker: ReturnType<typeof initStagingFaker>,
	globalOffset: number
): PeopleDoc[] {
	return buildPeople(
		{
			shelterCode: shelter.code,
			idPrefix: 'seed-st',
			padWidth: 4,
			zones: shelter.zones,
			faker,
			vulnerableGroupCode: (key) => masterCodes(master, 'vulnerable_group', key)[0],
			transferDestCode: shelter.code === SH001_CODE ? SH002_CODE : SH001_CODE,
			allowPets: shelter.code !== SH002_CODE,
			globalOffset
		},
		{ personIndex: 0, householdIndex: 0 },
		shelter.count,
		shelter.count
	).docs;
}

export async function seedStagingPeople(master: MasterLookup): Promise<void> {
	const faker = initStagingFaker();
	let offset = 0;

	for (const shelter of SHELTER_VOLUMES) {
		const db = shelterDbName(shelter.code);
		if (await alreadySeeded(db)) {
			console.log(`  ✓ ${db}: staging volume already present, skipping`);
			offset += shelter.count;
			continue;
		}

		const docs = buildShelterPeople(master, shelter, faker, offset);
		await bulkDocsBatched(db, docs, 150, { allowConflicts: true });
		const evacueeCount = docs.filter((d) => d.type === 'evacuee').length;
		const hhCount = docs.filter((d) => d.type === 'household').length;
		const movCount = docs.filter((d) => d.type === 'movement').length;
		console.log(
			`  ✓ ${db}: ${evacueeCount} evacuees, ${hhCount} households, ${movCount} movements (staging volume)`
		);
		offset += shelter.count;
	}

	const total = SHELTER_VOLUMES.reduce((s, x) => s + x.count, 0);
	console.log(`  ✓ staging people: ${total} evacuees across ${SHELTER_VOLUMES.length} shelters`);
}
