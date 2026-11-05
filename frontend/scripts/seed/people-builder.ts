/**
 * Pure household / evacuee / movement builder shared by the staging seed (`staging-people.ts`)
 * and the bulk seed (`seed-bulk-evacuees.ts`). No I/O: callers own CouchDB access and logging.
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
import { generatePersonProfile, nextHouseholdSize, type initStagingFaker } from './people-faker';

export type PeopleBuildConfig = {
	shelterCode: string;
	/** Doc id prefix after the type, e.g. `seed-st` or `seed-bulk`. */
	idPrefix: string;
	/** Zero-padding of the running evacuee / household number in ids. */
	padWidth: number;
	zones: string[];
	faker: ReturnType<typeof initStagingFaker>;
	/** Persisted vulnerable_group code for a profile key; throws when the key is unknown. */
	vulnerableGroupCode: (key: string) => string;
	/** Shelter that `transferred` evacuees move out to. */
	transferDestCode: string;
	/** False for shelters that do not host pets (the faker draw still happens). */
	allowPets: boolean;
	/** Added to the person index when generating profiles (staging runs shelters back to back). */
	globalOffset?: number;
};

export type PeopleBuildCursor = {
	/** Next evacuee index within the shelter (0-based). */
	personIndex: number;
	/** Next household index within the shelter (0-based). */
	householdIndex: number;
};

export type PeopleBuildResult = PeopleBuildCursor & { docs: PeopleDoc[] };

export function pad(n: number, width: number): string {
	return String(n).padStart(width, '0');
}

function needsCheckIn(status: string): boolean {
	return status === 'active' || status === 'room_confirmed' || status === 'temporary_leave';
}

function needsCheckOut(status: string): boolean {
	return status === 'checked_out' || status === 'transferred' || status === 'deceased';
}

function buildStay(
	evacuee: Evacuee,
	status: string,
	zone: string,
	transferDestCode: string,
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
		record(
			'xfer',
			createMovement(
				{
					evacuee_id: evacuee._id,
					action: 'transfer_out',
					zone: null,
					destination: { kind: 'shelter', shelter_code: transferDestCode }
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

/**
 * Builds whole households starting at `from` until `stopAt` evacuees are reached (a household
 * is never split, so the result can run past `stopAt`) or `total` is hit. Feeding the returned
 * cursor back in continues the exact same sequence, which is what makes chunked runs resumable.
 * Per household the docs are: household, then for each member its movements followed by itself.
 */
export function buildPeople(
	config: PeopleBuildConfig,
	from: PeopleBuildCursor,
	stopAt: number,
	total: number
): PeopleBuildResult {
	const { faker, idPrefix, padWidth, zones } = config;
	const ctx: AuthorContext = { shelterCode: config.shelterCode, createdBy: 'seed' };
	const codeSlug = config.shelterCode.toLowerCase();
	const evIdFor = (i: number) => `${idPrefix}:${codeSlug}:${pad(i, padWidth)}`;
	const globalOffset = config.globalOffset ?? 0;
	const docs: PeopleDoc[] = [];

	let { personIndex, householdIndex } = from;
	while (personIndex < stopAt && personIndex < total) {
		const size = Math.min(nextHouseholdSize(faker), total - personIndex);
		const profiles = Array.from({ length: size }, (_, j) =>
			generatePersonProfile(faker, globalOffset + personIndex + j)
		);
		const head = profiles[0];
		const householdId = `household:${idPrefix}:${codeSlug}:hh-${pad(householdIndex, padWidth)}`;
		const household: Household = {
			...createHousehold(
				{
					label: `ครัวเรือน${head.last_name}`,
					municipality_zone: head.zoneLabel,
					community: head.communityLabel,
					// housing_type persists stable CR-112 codes (= seed keys), not ULID item codes
					housing_type: head.housingTypeKey,
					head_evacuee_id: `evacuee:${evIdFor(personIndex)}`,
					pets:
						faker.datatype.boolean({ probability: 0.12 }) && config.allowPets
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
			const localIdx = personIndex + j;
			const evId = evIdFor(localIdx);
			const vg = p.vgKeys.map(config.vulnerableGroupCode);
			const zone = zones[localIdx % zones.length];

			// Start as pre_registered / arriving so check_in transitions are valid.
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

			const stay = buildStay(evacuee, p.status, zone, config.transferDestCode, ctx, evId);
			docs.push(...stay.movements, stay.evacuee);
		}

		personIndex += size;
		householdIndex += 1;
	}

	return { docs, personIndex, householdIndex };
}
