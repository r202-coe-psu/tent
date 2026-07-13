import { describe, it, expect, vi } from 'vitest';

// The real shelters barrel also re-exports its .svelte UI, which drags in an
// unrelated sveltekit-superforms/typebox adapter that crashes under Vitest's
// node environment. Stub the barrel with just the pure label-lookup module
// this domain function actually needs, so this test stays a fast, isolated
// unit test rather than tripping over an unrelated UI dependency.
vi.mock('$lib/features/shelters/index.js', async () => {
	const actual = await vi.importActual('../../shelters/domain/policy-labels');
	return actual;
});

const { buildDisclaimerGroups, FALLBACK_ASSET_ITEM, FALLBACK_VEHICLE_ITEM, FALLBACK_PET_ITEM } =
	await import('./disclaimer');
type ShelterSummary = import('$lib/features/shelters/index.js').ShelterSummary;

function baseInput() {
	return { assetDescription: '', petCount: 0, vehicleCount: 0, shelter: undefined };
}

describe('buildDisclaimerGroups', () => {
	it('returns no groups when nothing is brought and shelter is unconfigured', () => {
		expect(buildDisclaimerGroups(baseInput())).toEqual([]);
	});

	it('adds the assets group when assetDescription is non-blank, falling back when the shelter has no luggage rules configured', () => {
		const groups = buildDisclaimerGroups({ ...baseInput(), assetDescription: '  ทองคำ  ' });
		expect(groups).toEqual([
			{ label: '🎒 ทรัพย์สินมีค่า / สัมภาระ', items: [FALLBACK_ASSET_ITEM] }
		]);
	});

	it('does not add the assets group when assetDescription is only whitespace and nothing else is brought', () => {
		expect(buildDisclaimerGroups({ ...baseInput(), assetDescription: '   ' })).toEqual([]);
	});

	it('adds the assets group when pets are brought even with no asset description', () => {
		const groups = buildDisclaimerGroups({ ...baseInput(), petCount: 1 });
		expect(groups.map((g) => g.label)).toContain('🎒 ทรัพย์สินมีค่า / สัมภาระ');
	});

	it('renders configured luggage rules and appends rules_other', () => {
		const shelter = {
			luggage_policy: {
				rules: ['no_hazardous_items', 'no_large_appliances'],
				rules_other: 'ห้ามนำสัตว์มีพิษเข้ามา'
			}
		} as unknown as ShelterSummary;

		const groups = buildDisclaimerGroups({ ...baseInput(), assetDescription: 'แหวนทอง', shelter });

		expect(groups[0].items).toEqual([
			'ห้ามนำวัตถุไวไฟ สารเคมีอันตราย ยาเสพติด หรืออาวุธทุกชนิดเข้าศูนย์โดยเด็ดขาด (ตรวจพบแจ้งตำรวจทันที)',
			'ห้ามนำเครื่องใช้ไฟฟ้าขนาดใหญ่ (เช่น ตู้เย็น, ทีวี, เครื่องซักผ้า) เข้ามาในโซนพักอาศัย',
			'ห้ามนำสัตว์มีพิษเข้ามา'
		]);
	});

	it('adds the vehicles group only when a vehicle is brought, falling back when unconfigured', () => {
		expect(buildDisclaimerGroups({ ...baseInput(), vehicleCount: 0 })).toEqual([]);
		const groups = buildDisclaimerGroups({ ...baseInput(), vehicleCount: 1 });
		expect(groups.find((g) => g.label === '🚗 ยานพาหนะ')).toEqual({
			label: '🚗 ยานพาหนะ',
			items: [FALLBACK_VEHICLE_ITEM]
		});
	});

	it('renders configured parking rules and appends rules_other', () => {
		const shelter = {
			parking_policy: { rules: ['no_liability'], rules_other: 'ห้ามจอดซ้อนคัน' }
		} as unknown as ShelterSummary;

		const groups = buildDisclaimerGroups({ ...baseInput(), vehicleCount: 2, shelter });

		expect(groups.find((g) => g.label === '🚗 ยานพาหนะ')).toEqual({
			label: '🚗 ยานพาหนะ',
			items: ['ศูนย์ไม่รับผิดชอบต่อความสูญหายหรือความเสียหายของยานพาหนะในทุกกรณี', 'ห้ามจอดซ้อนคัน']
		});
	});

	it('adds the pets group only when a pet is brought, falling back when unconfigured', () => {
		expect(buildDisclaimerGroups({ ...baseInput(), petCount: 0 })).toEqual([]);
		const groups = buildDisclaimerGroups({ ...baseInput(), petCount: 1 });
		expect(groups.find((g) => g.label === '🐶 สัตว์เลี้ยง')).toEqual({
			label: '🐶 สัตว์เลี้ยง',
			items: [FALLBACK_PET_ITEM]
		});
	});

	it('shows the no-pets notice and ignores any configured categories when policy is no_pets', () => {
		const shelter = {
			admission_policy: {
				pet_policy: {
					policy: 'no_pets',
					categories: [{ category: 'small_general', conditions: ['bring_own_cage'] }]
				}
			}
		} as unknown as ShelterSummary;

		const groups = buildDisclaimerGroups({ ...baseInput(), petCount: 1, shelter });

		expect(groups.find((g) => g.label === '🐶 สัตว์เลี้ยง')).toEqual({
			label: '🐶 สัตว์เลี้ยง',
			items: ['ศูนย์นี้ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก (No Pets Allowed)']
		});
	});

	it('renders per-category conditions and "other" text for a conditional pet policy', () => {
		const shelter = {
			admission_policy: {
				pet_policy: {
					policy: 'conditional',
					categories: [
						{
							category: 'small_general',
							conditions: ['bring_own_cage', 'vaccine_book'],
							other: 'ห้ามเลี้ยงงู'
						}
					]
				}
			}
		} as unknown as ShelterSummary;

		const groups = buildDisclaimerGroups({ ...baseInput(), petCount: 1, shelter });

		expect(groups.find((g) => g.label === '🐶 สัตว์เลี้ยง')).toEqual({
			label: '🐶 สัตว์เลี้ยง',
			items: [
				'🐾 สัตว์เลี้ยงทั่วไป / ขนาดเล็ก (สุนัขพันธุ์เล็ก, แมว, นก, สัตว์น้ำ)',
				'ผู้พักพิงต้องเตรียมกรง / กระเป๋า / โหล มาเอง (ศูนย์ไม่มีอุปกรณ์รองรับ)',
				'ต้องแสดงสมุดวัคซีน (เช่น วัคซีนพิษสุนัขบ้า)',
				'ห้ามเลี้ยงงู'
			]
		});
	});

	it('falls back when policy is conditional but no categories are configured', () => {
		const shelter = {
			admission_policy: { pet_policy: { policy: 'conditional', categories: [] } }
		} as unknown as ShelterSummary;

		const groups = buildDisclaimerGroups({ ...baseInput(), petCount: 1, shelter });

		expect(groups.find((g) => g.label === '🐶 สัตว์เลี้ยง')).toEqual({
			label: '🐶 สัตว์เลี้ยง',
			items: [FALLBACK_PET_ITEM]
		});
	});

	it('groups multiple sections together in a single call, in asset/vehicle/pet order', () => {
		const groups = buildDisclaimerGroups({
			assetDescription: 'เงินสด',
			petCount: 1,
			vehicleCount: 1,
			shelter: undefined
		});

		expect(groups.map((g) => g.label)).toEqual([
			'🎒 ทรัพย์สินมีค่า / สัมภาระ',
			'🚗 ยานพาหนะ',
			'🐶 สัตว์เลี้ยง'
		]);
	});
});
