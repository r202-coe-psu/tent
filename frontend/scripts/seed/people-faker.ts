/**
 * Thai-locale person/household generators for staging volume seed.
 */
import { fakerTH } from '@faker-js/faker';
import type { Gender, Religion, StayStatus } from '$lib/features/people/domain/people';
import { HOUSING_TYPE_KEYS, SAMPLE_COMMUNITY_LABELS, SAMPLE_ZONE_LABELS } from './master-defs';

/** Deterministic seed so re-runs produce the same Thai names after a wipe. */
export const STAGING_FAKER_SEED = 20260912;

export function initStagingFaker(seed = STAGING_FAKER_SEED): typeof fakerTH {
	fakerTH.seed(seed);
	return fakerTH;
}

const RELIGIONS: Religion[] = [
	'buddhist',
	'buddhist',
	'buddhist',
	'muslim',
	'christian',
	'unknown'
];

/** Weighted stay statuses — mostly present, few terminal. */
const STATUS_WEIGHTS: { status: StayStatus; weight: number }[] = [
	{ status: 'active', weight: 55 },
	{ status: 'room_confirmed', weight: 10 },
	{ status: 'pre_registered', weight: 12 },
	{ status: 'arriving', weight: 5 },
	{ status: 'temporary_leave', weight: 8 },
	{ status: 'checked_out', weight: 7 },
	{ status: 'transferred', weight: 2 },
	{ status: 'deceased', weight: 1 }
];

const CHANNELS = ['kiosk', 'web', 'staff', 'backoffice', 'import'] as const;

const SPECIAL_NEEDS_SAMPLES = [
	'ต้องการแพมเพิส',
	'ใช้วีลแชร์',
	'ต้องการที่นอนเตี้ย',
	'แพ้อาหารทะเล',
	'ต้องการล่ามภาษามือ'
];

function pickWeighted<T extends string>(
	faker: typeof fakerTH,
	items: { status: T; weight: number }[]
): T {
	const total = items.reduce((s, i) => s + i.weight, 0);
	let r = faker.number.int({ min: 1, max: total });
	for (const item of items) {
		r -= item.weight;
		if (r <= 0) return item.status;
	}
	return items[0].status;
}

export type GeneratedPersonProfile = {
	first_name: string;
	last_name: string;
	gender: Gender;
	phone: string | null;
	birth_year: number;
	religion: Religion;
	vgKeys: string[];
	special_needs: string[];
	status: StayStatus;
	registered_via: (typeof CHANNELS)[number];
	/** Free-text community label (CR-137 — not a master code). */
	communityLabel: string;
	housingTypeKey: (typeof HOUSING_TYPE_KEYS)[number];
	/** Free-text municipality zone label (CR-137 — not a master code). */
	zoneLabel: string;
};

function ageToVgKeys(age: number, faker: typeof fakerTH): string[] {
	if (age <= 1) return ['infant'];
	if (age <= 5) return faker.datatype.boolean({ probability: 0.7 }) ? ['young_child'] : [];
	if (age >= 70) {
		const keys = ['elderly_dependent'];
		if (faker.datatype.boolean({ probability: 0.15 })) keys.push('wheelchair');
		if (faker.datatype.boolean({ probability: 0.08 })) keys.push('bedridden');
		return keys;
	}
	if (age >= 18 && age <= 45 && faker.datatype.boolean({ probability: 0.04 })) {
		return ['pregnant'];
	}
	if (faker.datatype.boolean({ probability: 0.06 })) return ['chronic_illness'];
	if (faker.datatype.boolean({ probability: 0.02 })) return ['dialysis'];
	if (faker.datatype.boolean({ probability: 0.02 })) return ['vision_impaired'];
	if (faker.datatype.boolean({ probability: 0.02 })) return ['hearing_impaired'];
	if (faker.datatype.boolean({ probability: 0.02 })) return ['disability_other'];
	if (faker.datatype.boolean({ probability: 0.015 })) return ['psychiatric'];
	return [];
}

export function generatePersonProfile(
	faker: typeof fakerTH,
	index: number
): GeneratedPersonProfile {
	const genderRoll = faker.number.int({ min: 0, max: 99 });
	const gender: Gender = genderRoll < 48 ? 'male' : genderRoll < 96 ? 'female' : 'other';

	const age = faker.number.int({ min: 0, max: 90 });
	const birth_year = new Date().getFullYear() + 543 - age;

	const communityLabel = SAMPLE_COMMUNITY_LABELS[index % SAMPLE_COMMUNITY_LABELS.length];
	const zoneLabel = SAMPLE_ZONE_LABELS[index % SAMPLE_ZONE_LABELS.length];

	let vgKeys = ageToVgKeys(age, faker);
	// pregnant only for female/other adults
	if (vgKeys.includes('pregnant') && gender === 'male') {
		vgKeys = vgKeys.filter((k) => k !== 'pregnant');
	}

	const status = pickWeighted(faker, STATUS_WEIGHTS);
	const phone =
		status === 'pre_registered' || faker.datatype.boolean({ probability: 0.75 })
			? `08${faker.string.numeric(8)}`
			: null;

	return {
		first_name: faker.person.firstName(),
		last_name: faker.person.lastName(),
		gender,
		phone,
		birth_year,
		religion: faker.helpers.arrayElement(RELIGIONS),
		vgKeys,
		special_needs: faker.datatype.boolean({ probability: 0.08 })
			? [faker.helpers.arrayElement(SPECIAL_NEEDS_SAMPLES)]
			: [],
		status,
		registered_via: CHANNELS[index % CHANNELS.length],
		communityLabel,
		housingTypeKey: faker.helpers.arrayElement([...HOUSING_TYPE_KEYS]),
		zoneLabel
	};
}

/** Approximate household size distribution for volume seed. */
export function nextHouseholdSize(faker: typeof fakerTH): number {
	const roll = faker.number.int({ min: 1, max: 100 });
	if (roll <= 25) return 1;
	if (roll <= 55) return 2;
	if (roll <= 80) return 3;
	if (roll <= 93) return 4;
	return 5;
}
