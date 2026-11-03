/**
 * Bulk evacuee volume for one shelter (load/demo testing), e.g.:
 *   pnpm seed:bulk-evacuees --shelter=SH001 --count=100000
 * Without --count it asks for the number in the terminal (default 100000).
 *
 * Adds households, evacuees and movements on top of the staging volume. Ids use the
 * `seed-bulk:` prefix so they never collide with `seed-st:` docs, and the run is chunked so
 * memory stays flat. Re-running is a no-op once the first bulk evacuee exists.
 */
import { createInterface } from 'node:readline/promises';
import type { AuthorContext } from '$lib/db/model';
import {
	applyMovementToStay,
	createEvacuee,
	createHousehold,
	createMovement,
	type Evacuee,
	type Household,
	type Movement,
	type PeopleDoc
} from '$lib/features/people/domain/people';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { bulkDocsBatched, couchReq, displayCouchUrl } from './seed/couch';
import { seedMasterData } from './seed/master-seed';
import { generatePersonProfile, initStagingFaker, nextHouseholdSize } from './seed/people-faker';
import { masterCodes, SH002_CODE } from './seed/types';

const ID_PREFIX = 'seed-bulk';
const ZONES = ['Z1', 'Z2', 'Z3', 'Z4'];
const FAKER_SEED = 20261103;
const CHUNK_PERSONS = 2000;

async function askCount(): Promise<string> {
	if (!process.stdin.isTTY) {
		throw new Error('pass --count=<n> when not running in a terminal');
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question('จำนวนผู้อพยพที่ต้องการ gen (ค่าเริ่มต้น 100000): ');
		return answer.trim() || '100000';
	} finally {
		rl.close();
	}
}

async function parseArgs(argv: string[]): Promise<{ shelter: string; count: number }> {
	const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
	const count = Number(arg('count') ?? (await askCount()));
	if (!Number.isInteger(count) || count <= 0) {
		throw new Error('count must be a positive integer');
	}
	return { shelter: (arg('shelter') ?? 'SH001').toUpperCase(), count };
}

function pad(n: number, width = 6): string {
	return String(n).padStart(width, '0');
}

function needsCheckIn(status: string): boolean {
	return status === 'active' || status === 'room_confirmed' || status === 'temporary_leave';
}

function needsCheckOut(status: string): boolean {
	return status === 'checked_out' || status === 'transferred' || status === 'deceased';
}

async function alreadySeeded(db: string, id: string): Promise<boolean> {
	const { status } = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	return status === 200;
}

function buildStay(
	evacuee: Evacuee,
	status: string,
	zone: string,
	shelterCode: string,
	ctx: AuthorContext,
	evId: string
): { evacuee: Evacuee; movements: Movement[] } {
	const movements: Movement[] = [];
	if (!needsCheckIn(status) && !needsCheckOut(status)) return { evacuee, movements };

	const record = (suffix: string, movement: Movement) => {
		movements.push({ ...movement, _id: `movement:${evId}-${suffix}` });
		evacuee = applyMovementToStay(evacuee, movements[movements.length - 1]);
	};

	record('in', createMovement({ evacuee_id: evacuee._id, action: 'check_in', zone }, ctx));

	if (status === 'temporary_leave') {
		record(
			'leave',
			createMovement({ evacuee_id: evacuee._id, action: 'leave_temporary', zone }, ctx)
		);
	} else if (status === 'checked_out') {
		record(
			'out',
			createMovement(
				{
					evacuee_id: evacuee._id,
					action: 'check_out',
					zone: null,
					destination: { kind: 'home' },
					reason: 'กลับบ้าน / ย้ายที่พักชั่วคราว'
				},
				ctx
			)
		);
	} else if (status === 'transferred') {
		const destCode = shelterCode === SH002_CODE ? 'SH001' : SH002_CODE;
		record(
			'xfer',
			createMovement(
				{
					evacuee_id: evacuee._id,
					action: 'transfer_out',
					zone: null,
					destination: { kind: 'shelter', shelter_code: destCode }
				},
				ctx
			)
		);
	} else if (status === 'deceased') {
		record('dec', createMovement({ evacuee_id: evacuee._id, action: 'mark_deceased', zone }, ctx));
	} else if (status === 'room_confirmed') {
		record('room', createMovement({ evacuee_id: evacuee._id, action: 'confirm_room', zone }, ctx));
	}

	return { evacuee, movements };
}

async function main(): Promise<void> {
	const { shelter, count } = await parseArgs(process.argv.slice(2));
	const db = shelterDbName(shelter);
	const codeSlug = shelter.toLowerCase();
	const evIdFor = (i: number) => `${ID_PREFIX}:${codeSlug}:${pad(i)}`;

	// Chunks are written in order, so the last evacuee existing means the whole run finished.
	if (await alreadySeeded(db, `evacuee:${evIdFor(count - 1)}`)) {
		console.log(`  ✓ ${db}: ${ID_PREFIX} volume already present, skipping`);
		return;
	}

	console.log(`\nAdding ${count} evacuees to ${db} → ${displayCouchUrl()}\n`);
	const master = await seedMasterData();
	const ctx: AuthorContext = { shelterCode: shelter, createdBy: 'seed' };
	const faker = initStagingFaker(FAKER_SEED);

	let personIndex = 0;
	let hhIndex = 0;
	while (personIndex < count) {
		const chunkEnd = Math.min(count, personIndex + CHUNK_PERSONS);
		const docs: PeopleDoc[] = [];

		while (personIndex < chunkEnd) {
			const size = Math.min(nextHouseholdSize(faker), count - personIndex);
			const profiles = Array.from({ length: size }, (_, j) =>
				generatePersonProfile(faker, personIndex + j)
			);
			const head = profiles[0];
			const householdId = `household:${ID_PREFIX}:${codeSlug}:hh-${pad(hhIndex)}`;
			const household: Household = {
				...createHousehold(
					{
						label: `ครัวเรือน${head.last_name}`,
						municipality_zone: head.zoneLabel,
						community: head.communityLabel,
						housing_type: head.housingTypeKey,
						head_evacuee_id: `evacuee:${evIdFor(personIndex)}`,
						pets: faker.datatype.boolean({ probability: 0.12 })
							? [{ species: faker.helpers.arrayElement(['dog', 'cat'] as const), count: 1 }]
							: [],
						address_no: `${faker.number.int({ min: 1, max: 200 })}/${faker.number.int({ min: 1, max: 40 })}`,
						village_no: String(faker.number.int({ min: 1, max: 12 })),
						subdistrict: 'หาดใหญ่',
						district: 'หาดใหญ่',
						province: 'สงขลา',
						postal_code: '90110'
					},
					ctx
				),
				_id: householdId
			};
			docs.push(household);

			for (let j = 0; j < profiles.length; j++) {
				const p = profiles[j];
				const evId = evIdFor(personIndex + j);
				const vg = p.vgKeys.length > 0 ? masterCodes(master, 'vulnerable_group', ...p.vgKeys) : [];
				const zone = ZONES[(personIndex + j) % ZONES.length];

				const evacuee: Evacuee = {
					...createEvacuee(
						{
							first_name: p.first_name,
							last_name: p.last_name,
							gender: p.gender,
							phone: p.phone,
							birth_year: p.birth_year,
							religion: p.religion,
							vulnerable_groups: vg,
							special_needs: p.special_needs,
							household_id: householdId,
							status:
								p.status === 'pre_registered' || p.status === 'arriving'
									? p.status
									: 'pre_registered',
							registered_via: p.registered_via,
							country: 'THAILAND'
						},
						ctx,
						null
					),
					_id: `evacuee:${evId}`
				};

				const stay = buildStay(evacuee, p.status, zone, shelter, ctx, evId);
				docs.push(...stay.movements, stay.evacuee);
			}

			personIndex += size;
			hhIndex += 1;
		}

		// Resume after a failed run: a chunk whose last evacuee exists was already written.
		if (await alreadySeeded(db, `evacuee:${evIdFor(personIndex - 1)}`)) {
			console.log(`  ✓ ${personIndex}/${count} already written, skipping chunk`);
			continue;
		}

		await bulkDocsBatched(db, docs, 150, { allowConflicts: true });
		console.log(`  ✓ ${personIndex}/${count} evacuees written`);
	}

	console.log(`\n  ✓ ${db}: ${count} bulk evacuees, ${hhIndex} households\n`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
