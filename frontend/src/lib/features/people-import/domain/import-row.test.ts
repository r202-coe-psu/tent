import { describe, expect, it } from 'vitest';
import { H } from './columns';
import {
	buildMasterLookup,
	emptyLookups,
	orphanMemberRows,
	validateRow,
	validateWorkbook,
	type Lookups,
	type RawRow,
	type RawSheetRow
} from './import-row';

/** The smallest household the contract accepts: T-48's required person fields. */
function minimalHead(overrides: RawRow = {}): RawRow {
	return {
		[H.first_name]: 'สมชาย',
		[H.last_name]: 'ใจดี',
		[H.gender]: 'ชาย',
		...overrides
	};
}

function memberRow(cells: RawRow, line = 1, ref = '1'): RawSheetRow {
	return { ref, line, cells };
}

function lookupsWithZone(): Lookups {
	return {
		municipality_zone: buildMasterLookup([{ code: 'Z1', label: 'เขต 1' }]),
		community: buildMasterLookup([{ code: 'C1', label: 'ชุมชนริมน้ำ' }])
	};
}

describe('validateRow — the minimum contract (T-48 required + CR-071 locks)', () => {
	it('accepts a household carrying only first name, last name and gender', () => {
		const result = validateRow(minimalHead(), 1, emptyLookups());

		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.payload?.head.first_name).toBe('สมชาย');
		// phone is required in the UI but nullable in the schema — a blank cell is
		// "no phone", not an error.
		expect(result.payload?.head.phone).toBeNull();
	});

	it('stamps every imported person as registered_via=import', () => {
		const result = validateRow(minimalHead(), 1, emptyLookups());
		expect(result.payload?.head.registered_via).toBe('import');
	});

	it('stamps every household as pre_registered — there is no status column', () => {
		const result = validateRow(minimalHead(), 1, emptyLookups());
		expect(result.payload?.household.status).toBe('pre_registered');
	});

	it('names the household after its head when the label cell is blank', () => {
		const result = validateRow(minimalHead(), 1, emptyLookups());
		expect(result.payload?.household.label).toBe('ครอบครัวสมชาย ใจดี');
	});

	it('keeps an explicit household name', () => {
		const result = validateRow(minimalHead({ [H.label]: 'บ้านสวนลุงมี' }), 1, emptyLookups());
		expect(result.payload?.household.label).toBe('บ้านสวนลุงมี');
	});

	it('reports a missing required field against its Thai column header', () => {
		const result = validateRow(minimalHead({ [H.first_name]: '' }), 1, emptyLookups());

		expect(result.ok).toBe(false);
		expect(result.errors.map((e) => e.column)).toContain(H.first_name);
		expect(result.errors[0].sheet).toBe('ครัวเรือน');
	});

	it('explains a blank label as a missing head name rather than a Zod message', () => {
		const result = validateRow({ [H.gender]: 'ชาย' }, 1, emptyLookups());

		const labelError = result.errors.find((e) => e.column === H.label);
		expect(labelError?.message).toContain('ไม่มีชื่อหัวหน้าครัวเรือน');
	});
});

describe('validateRow — cell resolution', () => {
	it('accepts an enum by code, full label or Thai prefix', () => {
		for (const value of ['female', 'หญิง (Female)', 'หญิง']) {
			const result = validateRow(minimalHead({ [H.gender]: value }), 1, emptyLookups());
			expect(result.payload?.head.gender).toBe('female');
		}
	});

	it('lists the accepted options when an enum cell is wrong', () => {
		const result = validateRow(minimalHead({ [H.gender]: 'ก' }), 1, emptyLookups());

		expect(result.ok).toBe(false);
		expect(result.errors.find((e) => e.column === H.gender)?.message).toContain('ชาย');
	});

	it('strips separators out of a formatted phone number', () => {
		const result = validateRow(minimalHead({ [H.phone]: '081-234-5678' }), 1, emptyLookups());
		expect(result.payload?.head.phone).toBe('0812345678');
	});

	it('reads "ไม่มี" as no phone', () => {
		const result = validateRow(minimalHead({ [H.phone]: 'ไม่มี' }), 1, emptyLookups());
		expect(result.ok).toBe(true);
		expect(result.payload?.head.phone).toBeNull();
	});

	it('rejects a phone that is not a number', () => {
		const result = validateRow(minimalHead({ [H.phone]: 'โทรบ้าน' }), 1, emptyLookups());
		expect(result.ok).toBe(false);
		expect(result.errors.map((e) => e.column)).toContain(H.phone);
	});

	it('resolves master data by label and by code', () => {
		const byLabel = validateRow(
			minimalHead({ [H.municipality_zone]: 'เขต 1', [H.community]: 'C1' }),
			1,
			lookupsWithZone()
		);

		expect(byLabel.payload?.household.municipality_zone).toBe('Z1');
		expect(byLabel.payload?.household.community).toBe('C1');
	});

	it('rejects master data the shelter does not have', () => {
		const result = validateRow(
			minimalHead({ [H.municipality_zone]: 'เขต 9' }),
			1,
			lookupsWithZone()
		);

		expect(result.ok).toBe(false);
		expect(result.errors.map((e) => e.column)).toContain(H.municipality_zone);
	});

	it('splits multi-value cells on | and rejects unknown tags', () => {
		const ok = validateRow(
			minimalHead({ [H.special_needs]: 'ผู้สูงอายุ | โรคเรื้อรัง' }),
			1,
			emptyLookups()
		);
		expect(ok.payload?.head.special_needs).toEqual(['elderly', 'chronic_illness']);

		const bad = validateRow(
			minimalHead({ [H.special_needs]: 'ผู้สูงอายุ | อื่นๆ' }),
			1,
			emptyLookups()
		);
		expect(bad.ok).toBe(false);
	});

	it('carries medical columns through so the write path creates a medical doc', () => {
		const result = validateRow(
			minimalHead({
				[H.medical_conditions]: 'เบาหวาน | ความดัน',
				[H.medical_allergies]: 'เพนิซิลลิน'
			}),
			1,
			emptyLookups()
		);

		expect(result.payload?.head.medical_conditions).toEqual(['เบาหวาน', 'ความดัน']);
		expect(result.payload?.head.medical_allergies).toEqual(['เพนิซิลลิน']);
	});

	it('assembles pets and vehicles from composite cells', () => {
		const result = validateRow(
			minimalHead({
				[H.pets]: 'สุนัข:2:มีกรง | แมว:1',
				[H.vehicles]: 'รถยนต์:กข 1234 | รถจักรยานยนต์:'
			}),
			1,
			emptyLookups()
		);

		expect(result.payload?.household.pets).toEqual([
			{ species: 'dog', count: 2, notes: 'มีกรง' },
			{ species: 'cat', count: 1 }
		]);
		expect(result.payload?.household.vehicles).toEqual([
			{ type: 'car', license_plate: 'กข 1234' },
			{ type: 'motorcycle', license_plate: null }
		]);
	});

	it('rejects an unknown pet species instead of dropping the row silently', () => {
		const result = validateRow(minimalHead({ [H.pets]: 'มังกร:1' }), 1, emptyLookups());

		expect(result.ok).toBe(false);
		expect(result.errors.map((e) => e.column)).toContain(H.pets);
	});

	it('requires an emergency contact to be complete once any part is filled', () => {
		const result = validateRow(minimalHead({ [H.emergency_name]: 'สมหญิง' }), 1, emptyLookups());

		expect(result.ok).toBe(false);
		expect(result.errors.map((e) => e.column)).toContain(H.emergency_phone);
	});

	it('defaults the emergency relation when only the name and phone are given', () => {
		const result = validateRow(
			minimalHead({ [H.emergency_name]: 'สมหญิง ใจดี', [H.emergency_phone]: '0898765432' }),
			1,
			emptyLookups()
		);

		expect(result.payload?.head.emergency_contact?.relation).toBe('contact');
	});
});

describe('validateRow — members', () => {
	it('attaches valid members and counts them', () => {
		const result = validateRow(minimalHead(), 1, emptyLookups(), [
			memberRow({ [H.first_name]: 'สมหญิง', [H.last_name]: 'ใจดี', [H.gender]: 'หญิง' }, 1)
		]);

		expect(result.ok).toBe(true);
		expect(result.memberCount).toBe(1);
		expect(result.payload?.members[0].evacuee.first_name).toBe('สมหญิง');
	});

	it('points a member error at the member sheet and its row', () => {
		const result = validateRow(minimalHead(), 1, emptyLookups(), [
			memberRow({ [H.last_name]: 'ใจดี', [H.gender]: 'หญิง' }, 4)
		]);

		expect(result.ok).toBe(false);
		const error = result.errors.find((e) => e.column === H.first_name);
		expect(error?.sheet).toBe('สมาชิก');
		expect(error?.line).toBe(4);
	});
});

describe('validateWorkbook', () => {
	it('joins members to their household by the join key', () => {
		const rows = validateWorkbook(
			{
				households: [
					{ ref: '1', line: 1, cells: minimalHead() },
					{ ref: '2', line: 2, cells: minimalHead({ [H.first_name]: 'มานี' }) }
				],
				members: [
					memberRow({ [H.first_name]: 'ก', [H.last_name]: 'ข', [H.gender]: 'หญิง' }, 1, '2'),
					memberRow({ [H.first_name]: 'ค', [H.last_name]: 'ง', [H.gender]: 'ชาย' }, 2, '2')
				]
			},
			emptyLookups()
		);

		expect(rows[0].memberCount).toBe(0);
		expect(rows[1].memberCount).toBe(2);
	});

	it('falls back to row position when the join key was cleared', () => {
		const rows = validateWorkbook(
			{
				households: [{ ref: '', line: 1, cells: minimalHead() }],
				members: [
					memberRow({ [H.first_name]: 'ก', [H.last_name]: 'ข', [H.gender]: 'หญิง' }, 1, '1')
				]
			},
			emptyLookups()
		);

		expect(rows[0].memberCount).toBe(1);
	});

	it('fails the later row when the same person appears twice in one file', () => {
		const cells = minimalHead({ [H.id_number]: '1234567890123' });
		const rows = validateWorkbook(
			{
				households: [
					{ ref: '1', line: 1, cells },
					{ ref: '2', line: 2, cells: { ...cells } }
				],
				members: []
			},
			emptyLookups()
		);

		expect(rows[0].ok).toBe(true);
		expect(rows[1].ok).toBe(false);
		expect(rows[1].errors.at(-1)?.message).toContain('แถวที่ 1');
	});

	it('lists member rows whose join key matches no household', () => {
		const wb = {
			households: [{ ref: '1', line: 1, cells: minimalHead() }],
			members: [memberRow({ [H.first_name]: 'ก', [H.last_name]: 'ข', [H.gender]: 'หญิง' }, 3, '9')]
		};

		expect(orphanMemberRows(wb).map((m) => m.line)).toEqual([3]);
	});
});
