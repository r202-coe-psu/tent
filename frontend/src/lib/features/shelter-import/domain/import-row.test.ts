import { describe, it, expect } from 'vitest';
import { luggageRuleLabels } from '$lib/features/shelters';
import { H, isTextColumn, PET_CONDITION_COLUMNS, SHEETS } from './columns';
import {
	buildMasterLookup,
	emptyLookups,
	orphanZoneRows,
	validateRow,
	validateRows,
	validateWorkbook,
	type Lookups,
	type ParsedWorkbook,
	type RawRow,
	type RawSheetRow
} from './import-row';

function lookups(): Lookups {
	return {
		shelter_type: buildMasterLookup([
			{ code: 'school', label: 'โรงเรียน' },
			{ code: 'temple', label: 'วัด (ศาสนสถาน)' }
		])
	};
}

function baseRow(over: Partial<RawRow> = {}): RawRow {
	return { [H.name]: 'ศูนย์ทดสอบ', [H.capacity]: '150', ...over };
}

describe('validateRow — happy path', () => {
	it('maps a minimal valid row to a shelter payload', () => {
		const r = validateRow(baseRow(), 1, emptyLookups());
		expect(r.ok).toBe(true);
		expect(r.name).toBe('ศูนย์ทดสอบ');
		expect(r.shelter?.capacity).toBe(150);
		// operation_status defaults to standby when the cell is blank
		expect(r.shelter?.operation_status).toBe('standby');
		// sub-objects the template omits are filled
		expect(r.shelter?.zones).toEqual([]);
	});

	it('resolves enum labels and codes to the code', () => {
		const byLabel = validateRow(
			baseRow({
				[H.operation_status]: 'เปิดรับผู้อพยพ (Active)',
				[H.area_type]: 'อาคารปิด (Indoor)'
			}),
			1,
			emptyLookups()
		);
		expect(byLabel.ok).toBe(true);
		expect(byLabel.shelter?.operation_status).toBe('active');
		expect(byLabel.shelter?.area_type).toBe('indoor');

		const byCode = validateRow(baseRow({ [H.operation_status]: 'closed' }), 1, emptyLookups());
		expect(byCode.shelter?.operation_status).toBe('closed');

		const byBase = validateRow(baseRow({ [H.project_level]: 'ระดับชุมชน' }), 1, emptyLookups());
		expect(byBase.shelter?.project_level).toBe('community');
	});

	it('resolves master-data label → code', () => {
		const byLabel = validateRow(baseRow({ [H.shelter_type]: 'โรงเรียน' }), 1, lookups());
		expect(byLabel.ok).toBe(true);
		expect(byLabel.shelter?.shelter_type).toBe('school');

		// Master-data columns match the label verbatim (or the raw code) — unlike
		// enum columns, the "…(…)" suffix is not optional here.
		const byFullLabel = validateRow(baseRow({ [H.shelter_type]: 'วัด (ศาสนสถาน)' }), 1, lookups());
		expect(byFullLabel.shelter?.shelter_type).toBe('temple');

		const byCode = validateRow(baseRow({ [H.shelter_type]: 'temple' }), 1, lookups());
		expect(byCode.shelter?.shelter_type).toBe('temple');
	});

	it('leaves the app-only fields unset — they are not in the workbook', () => {
		const r = validateRow(baseRow(), 1, lookups());
		expect(r.ok).toBe(true);
		expect(r.shelter?.municipality_zone).toBeNull();
		expect(r.shelter?.community).toBeNull();
		expect(r.shelter?.admission_policy?.supported_vulnerable_groups).toEqual([]);
	});
});

describe('validateRow — errors', () => {
	it('flags missing required name and capacity with Thai messages on the right columns', () => {
		const r = validateRow({ [H.name]: '', [H.capacity]: '' }, 3, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.name).toBeNull();
		const cols = r.errors.map((e) => e.column);
		expect(cols).toContain(H.name);
		expect(cols).toContain(H.capacity);
		expect(r.errors.find((e) => e.column === H.capacity)?.message).toBe(
			'ต้องระบุความจุสูงสุด (คน)'
		);
	});

	it('rejects an unknown enum value', () => {
		const r = validateRow(baseRow({ [H.operation_status]: 'ไม่รู้จัก' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors[0].column).toBe(H.operation_status);
	});

	it('rejects an unknown master-data label', () => {
		const r = validateRow(baseRow({ [H.shelter_type]: 'ไม่มีจริง' }), 1, lookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.shelter_type)?.message).toContain('ไม่พบ');
	});

	it('rejects capacity that is not positive', () => {
		const r = validateRow(baseRow({ [H.capacity]: '0' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.capacity)).toBeTruthy();
	});

	it('rejects latitude out of range', () => {
		const r = validateRow(baseRow({ [H.lat]: '999' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.lat)).toBeTruthy();
	});

	it('treats blank optional numbers as unset (not zero)', () => {
		const r = validateRow(baseRow({ [H.area_m2]: '' }), 1, emptyLookups());
		expect(r.ok).toBe(true);
		expect(r.shelter?.area_m2 ?? null).toBeNull();
	});
});

describe('validateRows', () => {
	it('numbers rows 1-based and preserves order', () => {
		const rows = validateRows([baseRow(), { [H.name]: '', [H.capacity]: '' }], emptyLookups());
		expect(rows[0].row).toBe(1);
		expect(rows[0].ok).toBe(true);
		expect(rows[1].row).toBe(2);
		expect(rows[1].ok).toBe(false);
	});
});

// ===== Extended coverage: the sheets beyond ข้อมูลศูนย์ =====

function zoneRow(cells: RawRow, line = 1, ref = '1'): RawSheetRow {
	return { ref, line, cells };
}

/** The ใช่/ไม่ใช่ column header for one pet condition. */
function petHeader(value: string): string {
	return PET_CONDITION_COLUMNS.find((c) => c.value === value)!.header;
}

describe('validateRow — booleans and gated numeric fields', () => {
	it('accepts Thai and English truthy/falsy words', () => {
		const r = validateRow(
			baseRow({ [H.car_toilet_accessible]: 'ใช่', [H.central_kitchen]: 'no' }),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.facilities.car_toilet_accessible).toBe(true);
		expect(r.shelter?.common_areas.central_kitchen).toBe(false);
	});

	it('rejects a boolean cell that is neither', () => {
		const r = validateRow(baseRow({ [H.helipad]: 'อาจจะ' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.helipad)?.message).toContain('ใช่');
	});

	it('clears car_toilet_supported when the shelter does not accept mobile toilets', () => {
		const r = validateRow(
			baseRow({ [H.car_toilet_accessible]: 'ไม่ใช่', [H.car_toilet_supported]: '3' }),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.facilities.car_toilet_supported).toBeNull();
	});

	it('keeps car_toilet_supported when mobile toilets are accepted', () => {
		const r = validateRow(
			baseRow({ [H.car_toilet_accessible]: 'ใช่', [H.car_toilet_supported]: '3' }),
			1,
			emptyLookups()
		);
		expect(r.shelter?.facilities.car_toilet_supported).toBe(3);
	});
});

describe('validateRow — multi-value cells', () => {
	it('splits on | and resolves labels and codes alike', () => {
		const r = validateRow(
			baseRow({
				[H.luggage_rules]: 'no_hazardous_items | ' + luggageRuleLabels.no_large_appliances
			}),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.luggage_policy?.rules).toEqual(['no_hazardous_items', 'no_large_appliances']);
	});

	it('does not split on commas — Thai option labels contain them', () => {
		const r = validateRow(
			baseRow({ [H.luggage_rules]: 'no_hazardous_items,no_large_appliances' }),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.luggage_rules)?.message).toContain('ไม่รู้จักค่า');
	});

	it('drops duplicate values in a multi-value cell', () => {
		const r = validateRow(
			baseRow({
				[H.parking_availability]: 'available',
				[H.parking_rules]: 'no_liability | no_liability'
			}),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.parking_policy?.rules).toEqual(['no_liability']);
	});

	it('surfaces the schema refine when a VHF channel is set without the VHF channel selected', () => {
		const r = validateRow(baseRow({ [H.vhf_channel]: 'CH12' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.vhf_channel)).toBeTruthy();
	});
});

describe('validateRow — communications as three boolean columns', () => {
	it('reassembles the array from the ใช่/ไม่ใช่ columns, in channel order', () => {
		const r = validateRow(
			baseRow({ [H.comm_wifi]: 'ใช่', [H.comm_cellular]: 'ใช่', [H.comm_vhf]: 'ไม่ใช่' }),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.utilities.communications).toEqual(['cellular', 'wifi']);
	});

	it('treats blank channel columns as not available', () => {
		const r = validateRow(baseRow(), 1, emptyLookups());
		expect(r.shelter?.utilities.communications).toEqual([]);
	});

	it('accepts a VHF channel once the VHF column is ใช่', () => {
		const r = validateRow(
			baseRow({ [H.comm_vhf]: 'ใช่', [H.vhf_channel]: 'CH12' }),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.utilities.communications).toEqual(['vhf_radio']);
		expect(r.shelter?.utilities.vhf_channel).toBe('CH12');
	});
});

describe('validateRow — sub storage list', () => {
	it('parses ชื่อ:ประเภท:พื้นที่ items', () => {
		const r = validateRow(
			baseRow({ [H.sub_storage]: 'คลังหน้าอาคาร:อาหารแห้ง:20 | คลังยา:เวชภัณฑ์' }),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.common_areas.sub_storage).toEqual([
			{ name: 'คลังหน้าอาคาร', type: 'food_dry', area_m2: 20 },
			{ name: 'คลังยา', type: 'medical_supplies', area_m2: null }
		]);
	});

	it('rejects an unknown storage type', () => {
		const r = validateRow(baseRow({ [H.sub_storage]: 'คลัง:ไม่รู้จัก' }), 1, emptyLookups());
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.sub_storage)).toBeTruthy();
	});
});

describe('validateRow — policies', () => {
	it('drops pet category detail when pets are not allowed', () => {
		const r = validateRow(
			baseRow({
				[H.pet_policy]: 'ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าศูนย์',
				[petHeader('vaccine_book')]: 'ใช่'
			}),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		expect(r.shelter?.admission_policy?.pet_policy?.policy).toBe('no_pets');
		expect(r.shelter?.admission_policy?.pet_policy?.categories).toEqual([]);
	});

	it('builds only the pet categories that have content', () => {
		const r = validateRow(
			baseRow({
				[H.pet_policy]: 'conditional',
				[petHeader('caged_or_leashed')]: 'ใช่',
				[H.pet_livestock_capacity]: '5',
				[H.pet_livestock_location]: 'ลานหลังอาคาร'
			}),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		const cats = r.shelter?.admission_policy?.pet_policy?.categories ?? [];
		expect(cats.map((c) => c.category)).toEqual(['small_general', 'livestock']);
		expect(cats[1]).toMatchObject({ max_capacity: 5, location: 'ลานหลังอาคาร' });
	});

	it('clears luggage max_per_family unless the limitation is "limited"', () => {
		const r = validateRow(
			baseRow({ [H.luggage_limitation]: 'no_limit', [H.luggage_max_per_family]: '4' }),
			1,
			emptyLookups()
		);
		expect(r.shelter?.luggage_policy?.max_per_family).toBeNull();
	});

	it('clears supported vehicles unless parking is available', () => {
		const withParking = validateRow(
			baseRow({ [H.parking_availability]: 'available', [H.park_car]: '20', [H.park_boat]: '2' }),
			1,
			emptyLookups()
		);
		expect(withParking.shelter?.parking_policy?.supported_vehicles).toEqual([
			{ type: 'car', max_capacity: 20 },
			{ type: 'boat', max_capacity: 2 }
		]);

		const withoutParking = validateRow(
			baseRow({ [H.parking_availability]: 'none', [H.park_car]: '20' }),
			1,
			emptyLookups()
		);
		expect(withoutParking.shelter?.parking_policy?.supported_vehicles).toEqual([]);
	});
});

describe('validateRow — zones sheet', () => {
	it('attaches zones to the shelter', () => {
		const r = validateRow(baseRow(), 1, emptyLookups(), [
			zoneRow({ [H.zone_code]: 'A', [H.zone_name]: 'โซนชาย', [H.zone_capacity]: '50' }, 1),
			zoneRow(
				{
					[H.zone_code]: 'B',
					[H.zone_name]: 'โซนหญิง',
					[H.zone_capacity]: '60',
					[H.zone_type]: 'หญิงล้วน'
				},
				2
			)
		]);
		expect(r.ok).toBe(true);
		expect(r.shelter?.zones).toHaveLength(2);
		expect(r.shelter?.zones[0]).toMatchObject({ code: 'A', type: 'general', status: 'active' });
		expect(r.shelter?.zones[1].type).toBe('female');
	});

	it('reports a zone error against the zone sheet and its row number', () => {
		const r = validateRow(baseRow(), 1, emptyLookups(), [
			zoneRow({ [H.zone_code]: 'A', [H.zone_name]: 'โซน', [H.zone_capacity]: '' }, 4)
		]);
		expect(r.ok).toBe(false);
		const err = r.errors.find((e) => e.column === H.zone_capacity);
		expect(err?.sheet).toBe('โซน');
		expect(err?.line).toBe(4);
		expect(err?.message).toBe('ต้องระบุความจุของโซน (คน)');
	});

	it('rejects a duplicate zone code within one shelter', () => {
		const r = validateRow(baseRow(), 1, emptyLookups(), [
			zoneRow({ [H.zone_code]: 'A', [H.zone_name]: 'หนึ่ง', [H.zone_capacity]: '10' }, 1),
			zoneRow({ [H.zone_code]: 'A', [H.zone_name]: 'สอง', [H.zone_capacity]: '10' }, 2)
		]);
		expect(r.ok).toBe(false);
		expect(r.errors.find((e) => e.column === H.zone_code)?.message).toContain('ซ้ำ');
	});
});

describe('validateWorkbook', () => {
	const wb: ParsedWorkbook = {
		shelters: [
			{ ref: '1', line: 1, cells: baseRow({ [H.name]: 'ศูนย์ ก' }) },
			{ ref: '2', line: 2, cells: baseRow({ [H.name]: 'ศูนย์ ข' }) }
		],
		zones: [
			zoneRow({ [H.zone_code]: 'A', [H.zone_name]: 'โซน A', [H.zone_capacity]: '10' }, 1, '2'),
			zoneRow({ [H.zone_code]: 'B', [H.zone_name]: 'โซน B', [H.zone_capacity]: '10' }, 2, '9')
		]
	};

	it('joins zone rows to the right shelter by ลำดับที่', () => {
		const rows = validateWorkbook(wb, emptyLookups());
		expect(rows[0].shelter?.zones).toEqual([]);
		expect(rows[1].shelter?.zones.map((z) => z.code)).toEqual(['A']);
	});

	it('falls back to position when ลำดับที่ is blank', () => {
		const rows = validateWorkbook(
			{
				shelters: [{ ref: '', line: 1, cells: baseRow() }],
				zones: [
					zoneRow({ [H.zone_code]: 'A', [H.zone_name]: 'โซน A', [H.zone_capacity]: '10' }, 1, '1')
				]
			},
			emptyLookups()
		);
		expect(rows[0].shelter?.zones.map((z) => z.code)).toEqual(['A']);
	});

	it('reports zone rows whose ลำดับที่ matches no shelter', () => {
		expect(orphanZoneRows(wb).map((z) => z.line)).toEqual([2]);
	});

	it('flags a row that repeats an earlier row name, leaving the first row ok', () => {
		const rows = validateWorkbook(
			{
				shelters: [
					{ ref: '1', line: 1, cells: baseRow({ [H.name]: 'ศูนย์ ซ้ำ' }) },
					{ ref: '2', line: 2, cells: baseRow({ [H.name]: '  ศูนย์   ซ้ำ  ' }) }
				],
				zones: []
			},
			emptyLookups()
		);

		expect(rows[0].ok).toBe(true);
		expect(rows[0].shelter).toBeDefined();

		expect(rows[1].ok).toBe(false);
		expect(rows[1].shelter).toBeUndefined();
		const err = rows[1].errors.find((e) => e.column === H.name);
		expect(err?.message).toBe('ชื่อซ้ำกับแถวที่ 1 ในไฟล์เดียวกัน');
	});
});

describe('validateRow — text fields are taken verbatim', () => {
	// Leading zeros survive because the template stamps these columns as Text
	// (`isTextColumn`) — the validator itself never reformats them.
	it('keeps a phone number exactly as typed, leading zero and all', () => {
		for (const input of ['0800000000', '074-123456', '+66800000000', '1669']) {
			const r = validateRow(baseRow({ [H.contact_phone]: input }), 1, emptyLookups());
			expect(r.ok).toBe(true);
			expect(r.shelter?.contact?.phone).toBe(input);
		}
	});

	it('keeps key-personnel phones and postal codes verbatim', () => {
		const r = validateRow(
			baseRow({ [H.eoc_liaison_phone]: '074123456', [H.postal_code]: '90110' }),
			1,
			emptyLookups()
		);
		expect(r.shelter?.key_personnel?.eoc_liaison?.phone).toBe('074123456');
		expect(r.shelter?.postal_code).toBe('90110');
	});
});

describe('template column formats', () => {
	const kindOf = (header: string) =>
		SHEETS.flatMap((s) => s.columns).find((c) => c.header === header)?.kind;

	it('marks the columns Excel would mangle as Text', () => {
		// Phone numbers lose their leading zero, บ้านเลขที่ like "1/2" become dates.
		for (const header of [
			H.contact_phone,
			H.eoc_liaison_phone,
			H.medical_lead_phone,
			H.kitchen_lead_phone,
			H.postal_code,
			H.address_no,
			H.village_no,
			H.vhf_channel,
			H.zone_code
		]) {
			expect(isTextColumn(kindOf(header)!), header).toBe(true);
		}
	});

	it('leaves genuinely numeric columns numeric', () => {
		for (const header of [H.ref, H.capacity, H.area_m2, H.lat, H.lng, H.zone_capacity]) {
			expect(isTextColumn(kindOf(header)!), header).toBe(false);
		}
	});
});

describe('validateRow — pet conditions as boolean columns', () => {
	it('reassembles each category conditions array from its ใช่/ไม่ใช่ columns', () => {
		const r = validateRow(
			baseRow({
				[H.pet_policy]: 'conditional',
				[petHeader('caged_or_leashed')]: 'ใช่',
				[petHeader('vaccine_book')]: 'ใช่',
				[petHeader('owner_hygiene')]: 'ไม่ใช่',
				[petHeader('muzzle_and_leash')]: 'ใช่',
				[petHeader('owner_provides_feed')]: 'ใช่'
			}),
			1,
			emptyLookups()
		);
		expect(r.ok).toBe(true);
		const cats = r.shelter?.admission_policy?.pet_policy?.categories ?? [];
		expect(cats.map((c) => c.category)).toEqual(['small_general', 'large_dog', 'livestock']);
		expect(cats[0].conditions).toEqual(['caged_or_leashed', 'vaccine_book']);
		expect(cats[1].conditions).toEqual(['muzzle_and_leash']);
		expect(cats[2].conditions).toEqual(['owner_provides_feed']);
	});

	it('gives every condition its own column, one per category whitelist', () => {
		const headers = PET_CONDITION_COLUMNS.map((c) => c.header);
		expect(headers).toHaveLength(11);
		expect(new Set(headers).size).toBe(11);
		// Every condition column exists on the นโยบาย sheet as a boolean.
		const policySheet = SHEETS.find((s) => s.name === 'นโยบาย')!;
		for (const c of PET_CONDITION_COLUMNS) {
			expect(policySheet.columns.find((col) => col.header === c.header)?.kind, c.header).toBe(
				'boolean'
			);
		}
	});
});
