import { describe, expect, it } from 'vitest';
import { EVACUEE_SEARCH_I18N } from '$lib/features/people';
import {
	CARD_TYPE_CHOICES,
	GENDER_CHOICES,
	H,
	RELIGION_CHOICES
} from '$lib/features/people-import';
import {
	buildConsulateRows,
	CONSULATE_HEADERS,
	consulateFileName,
	formatBangkokDateTime,
	listExportCountries
} from './consulate-export';
import { fakeEvacuee, mixedRoster } from './evacuee.fixture';

const label = (c: { value: string; label: string }[], v: string) =>
	c.find((x) => x.value === v)!.label;

describe('listExportCountries (S2, FR-12)', () => {
	it('trims + uppercases, merges casing, excludes THAILAND and non-exportable people', () => {
		expect(listExportCountries(mixedRoster())).toEqual([
			{ country: 'MYANMAR', count: 4 },
			{ country: 'LAOS', count: 1 }
		]);
	});

	it('counts only exportable people (pre_registered/kiosk/cancelled/anonymized never count)', () => {
		const only = [
			fakeEvacuee('a', {
				country: 'JAPAN',
				current_stay: { status: 'pre_registered', zone: null, since: '' }
			}),
			fakeEvacuee('b', { country: 'JAPAN', anonymized: true })
		];
		expect(listExportCountries(only)).toEqual([]);
	});

	it('ignores blank country and THAILAND in any casing', () => {
		expect(
			listExportCountries([
				fakeEvacuee('a', { country: '  thailand ' }),
				fakeEvacuee('b', { country: '   ' })
			])
		).toEqual([]);
	});
});

describe('buildConsulateRows (S1)', () => {
	const table = buildConsulateRows(mixedRoster(), 'MYANMAR', {
		zones: [{ code: 'z1', name: 'โซน A' }],
		vulnerableGroups: [{ code: 'bedridden', label_th: 'ผู้ป่วยติดเตียง' }]
	});

	it('uses the FR-30 columns in exact order', () => {
		expect(table.headers).toEqual([
			'ลำดับ',
			H.first_name,
			H.last_name,
			H.gender,
			'ปีเกิด (พ.ศ.)',
			'อายุ (ปี)',
			H.country,
			H.card_type,
			'เลขบัตร/passport',
			'เบอร์โทร',
			'สถานะการพัก',
			'วันที่เริ่มสถานะ',
			'โซน',
			'ผู้ติดต่อฉุกเฉิน: ชื่อ-นามสกุล',
			'ผู้ติดต่อฉุกเฉิน: เบอร์โทร',
			'ผู้ติดต่อฉุกเฉิน: ความสัมพันธ์',
			'ศาสนา',
			'กลุ่มเปราะบาง',
			'ความต้องการพิเศษ'
		]);
		expect(table.headers).toBe(CONSULATE_HEADERS);
	});

	it('includes only the chosen country and excluded statuses/anonymized are absent (FR-20/21)', () => {
		const names = table.rows.map((r) => r[1]);
		expect(names).toEqual(['Aung', 'Aung', 'Hla', 'Zaw']);
		expect(names).not.toContain('PreReg');
		expect(names).not.toContain('Purged');
		expect(names).not.toContain('John');
	});

	it('sorts by first name then last name and numbers rows 1..n (FR-32)', () => {
		expect(table.rows.map((r) => [r[0], r[1], r[2]])).toEqual([
			[1, 'Aung', 'Aye'],
			[2, 'Aung', 'Kyaw'],
			[3, 'Hla', 'Doe'],
			[4, 'Zaw', 'Min']
		]);
	});

	it('keeps search_excluded and consent-basic people (FR-22)', () => {
		expect(table.rows.find((r) => r[2] === 'Kyaw')).toBeDefined();
	});

	it('maps a full row to labels and +07 time', () => {
		const zaw = table.rows.find((r) => r[1] === 'Zaw')!;
		expect(zaw).toEqual([
			4,
			'Zaw',
			'Min',
			label(GENDER_CHOICES, 'male'),
			2530,
			43,
			'MYANMAR',
			label(CARD_TYPE_CHOICES, 'passport'),
			'MA0123456',
			'0812345678',
			`${EVACUEE_SEARCH_I18N.th.statusLabels.active} (${EVACUEE_SEARCH_I18N.en.statusLabels.active})`,
			'2026-11-02 10:05',
			'โซน A',
			'Aye Min',
			'0899999999',
			'ภรรยา',
			label(RELIGION_CHOICES, 'buddhist'),
			'ผู้ป่วยติดเตียง,disability_other,ใช้ไม้เท้า',
			'อาหารเจ,ยาประจำตัว'
		]);
	});

	it('leaves missing values empty and never derives age <-> birth year (FR-30)', () => {
		const kyaw = table.rows.find((r) => r[2] === 'Kyaw')!;
		expect(kyaw[3]).toBe(label(GENDER_CHOICES, 'female'));
		expect(kyaw[4]).toBeNull(); // no birth year, not computed from age
		expect(kyaw[5]).toBe(30);
		expect(kyaw[7]).toBeNull(); // anonymous id is not a real document
		expect(kyaw[8]).toBeNull();
		expect(kyaw[9]).toBeNull();
		expect(kyaw.slice(12)).toEqual([null, null, null, null, 'ผี', null, null]);
	});

	it('shows religion_other for other, and an unparseable since as empty', () => {
		expect(table.rows.find((r) => r[2] === 'Kyaw')![16]).toBe('ผี');
		expect(table.rows.find((r) => r[1] === 'Hla')![11]).toBeNull();
	});

	it('labels every exportable status bilingually (FR-30a)', () => {
		for (const status of [
			'arriving',
			'active',
			'room_confirmed',
			'temporary_leave',
			'transferred',
			'checked_out',
			'deceased'
		] as const) {
			const t = buildConsulateRows(
				[fakeEvacuee('x', { current_stay: { status, zone: null, since: '2026-11-02T00:00:00Z' } })],
				'MYANMAR'
			);
			expect(t.rows[0][10]).toBe(
				`${EVACUEE_SEARCH_I18N.th.statusLabels[status]} (${EVACUEE_SEARCH_I18N.en.statusLabels[status]})`
			);
		}
	});

	it('never builds a THAILAND file even if asked directly', () => {
		expect(buildConsulateRows(mixedRoster(), ' thailand ').rows).toEqual([]);
	});

	it('returns no rows for an empty or unknown country', () => {
		expect(buildConsulateRows(mixedRoster(), '').rows).toEqual([]);
		expect(buildConsulateRows(mixedRoster(), 'ICELAND').rows).toEqual([]);
	});
});

describe('time + filename helpers (FR-5, FR-13)', () => {
	it('formats +07 across the UTC date boundary', () => {
		expect(formatBangkokDateTime('2026-11-03T17:30:00.000Z')).toBe('2026-11-04 00:30');
		expect(formatBangkokDateTime(null)).toBeNull();
	});

	it('builds consulate-{shelter}-{country}-{YYYYMMDD-HHmm}.xlsx in +07', () => {
		expect(consulateFileName('SH001', 'MYANMAR', new Date('2026-11-06T17:09:00Z'))).toBe(
			'consulate-SH001-MYANMAR-20261107-0009.xlsx'
		);
	});
});
