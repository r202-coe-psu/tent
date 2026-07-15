import {
	luggageRuleLabels,
	parkingRuleLabels,
	petCategoryLabels,
	petConditionLabels,
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

export function buildDisclaimerGroups(input: {
	assetDescription: string;
	petCount: number;
	vehicleCount: number;
	shelter: ShelterSummary | undefined;
}): DisclaimerGroup[] {
	const { assetDescription, petCount, vehicleCount, shelter } = input;
	const groups: DisclaimerGroup[] = [];

	if (assetDescription.trim() || petCount > 0 || vehicleCount > 0) {
		const items: string[] = [];
		const rules = shelter?.luggage_policy?.rules ?? [];
		for (const rule of rules) items.push(luggageRuleLabels[rule]);
		if (shelter?.luggage_policy?.rules_other) items.push(shelter.luggage_policy.rules_other);
		if (items.length === 0) items.push(FALLBACK_ASSET_ITEM);
		groups.push({ label: '🎒 ทรัพย์สินมีค่า / สัมภาระ', items });
	}

	if (vehicleCount > 0) {
		const items: string[] = [];
		const rules = shelter?.parking_policy?.rules ?? [];
		for (const rule of rules) items.push(parkingRuleLabels[rule]);
		if (shelter?.parking_policy?.rules_other) items.push(shelter.parking_policy.rules_other);
		if (items.length === 0) items.push(FALLBACK_VEHICLE_ITEM);
		groups.push({ label: '🚗 ยานพาหนะ', items });
	}

	if (petCount > 0) {
		const items: string[] = [];
		const petPolicy = shelter?.admission_policy?.pet_policy;
		if (petPolicy?.policy === 'no_pets') {
			items.push('ศูนย์นี้ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก (No Pets Allowed)');
		} else {
			const categories = petPolicy?.categories ?? [];
			for (const entry of categories) {
				items.push(petCategoryLabels[entry.category]);
				for (const cond of entry.conditions ?? []) {
					items.push(petConditionLabels[cond as PetCondition]);
				}
				if (entry.other) items.push(entry.other);
			}
			if (categories.length === 0) items.push(FALLBACK_PET_ITEM);
		}
		groups.push({ label: '🐶 สัตว์เลี้ยง', items });
	}

	return groups;
}
