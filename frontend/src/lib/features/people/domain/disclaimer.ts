import {
	policyLabelsByLanguage,
	type PetCondition,
	type ShelterSummary
} from '$lib/features/shelters/index.js';

export type DisclaimerGroup = { label: string; items: string[] };

export const FALLBACK_ASSET_ITEM =
	'ทรัพย์สินมีค่าที่นำติดตัวมา ผู้พักพิงต้องเก็บและรับผิดชอบด้วยตนเอง ศูนย์ไม่รับผิดชอบกรณีสูญหาย';
export const FALLBACK_VEHICLE_ITEM =
	'ต้องลงทะเบียนยานพาหนะทุกคัน และจอดในพื้นที่ที่ศูนย์กำหนดเท่านั้น';
export const FALLBACK_PET_ITEM =
	'ต้องดูแลควบคุมสัตว์เลี้ยง (กรง/สายจูง) ตลอดเวลา และรับผิดชอบต่อสัตว์เลี้ยงของตนเอง';

export type DisclaimerLanguage = 'th' | 'en';

const DISCLAIMER_COPY: Record<
	DisclaimerLanguage,
	{
		assetLabel: string;
		vehicleLabel: string;
		petLabel: string;
		assetFallback: string;
		vehicleFallback: string;
		petFallback: string;
		noPets: string;
	}
> = {
	th: {
		assetLabel: '🎒 ทรัพย์สินมีค่า / สัมภาระ',
		vehicleLabel: '🚗 ยานพาหนะ',
		petLabel: '🐶 สัตว์เลี้ยง',
		assetFallback: FALLBACK_ASSET_ITEM,
		vehicleFallback: FALLBACK_VEHICLE_ITEM,
		petFallback: FALLBACK_PET_ITEM,
		noPets: 'ศูนย์นี้ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก (No Pets Allowed)'
	},
	en: {
		assetLabel: '🎒 Valuables / luggage',
		vehicleLabel: '🚗 Vehicles',
		petLabel: '🐶 Pets',
		assetFallback:
			'You must keep and take responsibility for any valuables you bring. The shelter is not liable for any loss.',
		vehicleFallback:
			'Every vehicle must be registered and parked only in the area the shelter designates.',
		petFallback:
			'Pets must be kept under control (cage / leash) at all times, and owners are responsible for their own pets.',
		noPets: 'This shelter does not allow pets.'
	}
};

/** Master-data rules follow `language`; shelter free text (`rules_other`, `other`) stays as entered. */
export function buildDisclaimerGroups(input: {
	assetDescription: string;
	petCount: number;
	vehicleCount: number;
	shelter: ShelterSummary | undefined;
	language?: DisclaimerLanguage;
}): DisclaimerGroup[] {
	const { assetDescription, petCount, vehicleCount, shelter, language = 'th' } = input;
	const copy = DISCLAIMER_COPY[language];
	const labels = policyLabelsByLanguage[language];
	const groups: DisclaimerGroup[] = [];

	if (assetDescription.trim() || petCount > 0 || vehicleCount > 0) {
		const items: string[] = [];
		const rules = shelter?.luggage_policy?.rules ?? [];
		for (const rule of rules) items.push(labels.luggage[rule]);
		if (shelter?.luggage_policy?.rules_other) items.push(shelter.luggage_policy.rules_other);
		if (items.length === 0) items.push(copy.assetFallback);
		groups.push({ label: copy.assetLabel, items });
	}

	if (vehicleCount > 0) {
		const items: string[] = [];
		const rules = shelter?.parking_policy?.rules ?? [];
		for (const rule of rules) items.push(labels.parking[rule]);
		if (shelter?.parking_policy?.rules_other) items.push(shelter.parking_policy.rules_other);
		if (items.length === 0) items.push(copy.vehicleFallback);
		groups.push({ label: copy.vehicleLabel, items });
	}

	if (petCount > 0) {
		const items: string[] = [];
		const petPolicy = shelter?.admission_policy?.pet_policy;
		if (petPolicy?.policy === 'no_pets') {
			items.push(copy.noPets);
		} else {
			const categories = petPolicy?.categories ?? [];
			for (const entry of categories) {
				items.push(labels.petCategory[entry.category]);
				for (const cond of entry.conditions ?? []) {
					items.push(labels.petCondition[cond as PetCondition]);
				}
				if (entry.other) items.push(entry.other);
			}
			if (categories.length === 0) items.push(copy.petFallback);
		}
		groups.push({ label: copy.petLabel, items });
	}

	return groups;
}
