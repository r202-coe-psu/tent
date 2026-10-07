/**
 * Staging volume people: ~1,000 evacuees across SH001–SH003 with Thai faker names.
 */
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
import { prefixRangeEnd } from '../t31-seed-support';
import { bulkDocsBatched, couchReq } from './couch';
import { generatePersonProfile, initStagingFaker, nextHouseholdSize } from './people-faker';
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

function pad(n: number, width = 4): string {
	return String(n).padStart(width, '0');
}

function needsCheckIn(status: string): boolean {
	return status === 'active' || status === 'room_confirmed' || status === 'temporary_leave';
}

function needsCheckOut(status: string): boolean {
	return status === 'checked_out' || status === 'transferred' || status === 'deceased';
}

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
	const ctx: AuthorContext = { shelterCode: shelter.code, createdBy: 'seed' };
	const codeSlug = shelter.code.toLowerCase();
	const docs: PeopleDoc[] = [];

	let personIndex = 0;
	let hhIndex = 0;

	while (personIndex < shelter.count) {
		const size = Math.min(nextHouseholdSize(faker), shelter.count - personIndex);
		const profiles = Array.from({ length: size }, (_, j) =>
			generatePersonProfile(faker, globalOffset + personIndex + j)
		);
		const head = profiles[0];

		const hhId = `seed-st:${codeSlug}:hh-${pad(hhIndex)}`;
		const household: Household = {
			...createHousehold(
				{
					label: `ครัวเรือน${head.last_name}`,
					municipality_zone: head.zoneLabel,
					community: head.communityLabel,
					// housing_type persists stable CR-112 codes (= seed keys), not ULID item codes
					housing_type: head.housingTypeKey,
					head_evacuee_id: null,
					pets:
						faker.datatype.boolean({ probability: 0.12 }) && shelter.code !== SH002_CODE
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
			_id: `household:${hhId}`
		};
		docs.push(household);

		const memberEvacuees: Evacuee[] = [];
		for (let j = 0; j < profiles.length; j++) {
			const p = profiles[j];
			const localIdx = personIndex + j;
			const evId = `seed-st:${codeSlug}:${pad(localIdx)}`;
			const vg = p.vgKeys.length > 0 ? masterCodes(master, 'vulnerable_group', ...p.vgKeys) : [];

			// Start as pre_registered / arriving so check_in transitions are valid.
			const initialStatus =
				p.status === 'pre_registered' || p.status === 'arriving' ? p.status : 'pre_registered';

			let evacuee: Evacuee = {
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
						household_id: household._id,
						status: initialStatus,
						registered_via: p.registered_via,
						country: 'THAILAND'
					},
					ctx
				),
				_id: `evacuee:${evId}`
			};

			const zone = shelter.zones[localIdx % shelter.zones.length];

			if (needsCheckIn(p.status) || needsCheckOut(p.status)) {
				const checkIn: Movement = {
					...createMovement({ evacuee_id: evacuee._id, action: 'check_in', zone }, ctx),
					_id: `movement:${evId}-in`
				};
				evacuee = applyMovementToStay(evacuee, checkIn);
				docs.push(checkIn);

				if (p.status === 'temporary_leave') {
					const leave: Movement = {
						...createMovement({ evacuee_id: evacuee._id, action: 'leave_temporary', zone }, ctx),
						_id: `movement:${evId}-leave`
					};
					evacuee = applyMovementToStay(evacuee, leave);
					docs.push(leave);
				} else if (p.status === 'checked_out') {
					const out: Movement = {
						...createMovement(
							{
								evacuee_id: evacuee._id,
								action: 'check_out',
								zone: null,
								destination: { kind: 'home' },
								reason: 'กลับบ้าน / ย้ายที่พักชั่วคราว'
							},
							ctx
						),
						_id: `movement:${evId}-out`
					};
					evacuee = applyMovementToStay(evacuee, out);
					docs.push(out);
				} else if (p.status === 'transferred') {
					const destCode = shelter.code === SH001_CODE ? SH002_CODE : SH001_CODE;
					const out: Movement = {
						...createMovement(
							{
								evacuee_id: evacuee._id,
								action: 'transfer_out',
								zone: null,
								destination: { kind: 'shelter', shelter_code: destCode }
							},
							ctx
						),
						_id: `movement:${evId}-xfer`
					};
					evacuee = applyMovementToStay(evacuee, out);
					docs.push(out);
				} else if (p.status === 'deceased') {
					const out: Movement = {
						...createMovement({ evacuee_id: evacuee._id, action: 'mark_deceased', zone }, ctx),
						_id: `movement:${evId}-dec`
					};
					evacuee = applyMovementToStay(evacuee, out);
					docs.push(out);
				} else if (p.status === 'room_confirmed') {
					const confirm: Movement = {
						...createMovement({ evacuee_id: evacuee._id, action: 'confirm_room', zone }, ctx),
						_id: `movement:${evId}-room`
					};
					evacuee = applyMovementToStay(evacuee, confirm);
					docs.push(confirm);
				}
			}

			memberEvacuees.push(evacuee);
			docs.push(evacuee);
		}

		// Link head
		if (memberEvacuees[0]) {
			const headIdx = docs.findIndex((d) => d._id === household._id);
			if (headIdx >= 0) {
				docs[headIdx] = {
					...(docs[headIdx] as Household),
					head_evacuee_id: memberEvacuees[0]._id
				};
			}
		}

		personIndex += size;
		hhIndex += 1;
	}

	return docs;
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
