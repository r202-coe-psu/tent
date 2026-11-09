import { describe, expect, it } from 'vitest';
import { collectMemberRuleIssues } from './people';
import { toRegistrationEntries, type RegistrationIssue } from './registration-validation';
import { localizeRegistrationMessage } from './registration-messages.i18n';
import {
	unifiedRegistrationInputSchema,
	type UnifiedRegistrationInput
} from './unified-registration';

const THAI = /[฀-๿]/;

type Member = UnifiedRegistrationInput['members'][number];
type Household = UnifiedRegistrationInput['household'];

function member(over: Record<string, unknown> = {}): Member {
	return {
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male',
		phone: '0812345678',
		country: 'THAILAND',
		vulnerable_groups: [],
		special_needs: [],
		person_id: { cardType: 'national_id', number: '1234567890121' },
		...over
	} as Member;
}

function household(over: Record<string, unknown> = {}): Household {
	return {
		housing_type: 'owned_house',
		address_no: '12/3',
		subdistrict: 'หาดใหญ่',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90110',
		pets: [],
		vehicles: [],
		assets: null,
		...over
	} as Household;
}

function input(over: Record<string, unknown> = {}): UnifiedRegistrationInput {
	return { members: [member()], household: household(), ...over } as UnifiedRegistrationInput;
}

/** Same pass the form runs: schema issues + the member rules reported separately. */
function issuesFor(payload: UnifiedRegistrationInput): RegistrationIssue[] {
	const parsed = unifiedRegistrationInputSchema.safeParse(payload);
	if (parsed.success) return [];
	return [...parsed.error.issues, ...collectMemberRuleIssues(payload.members)];
}

const memberCases: Record<string, Record<string, unknown>> = {
	'first name missing': { first_name: '' },
	'first name absent': { first_name: undefined },
	'phone malformed': { phone: '123' },
	'phone absent': { phone: undefined },
	'gender not picked': { gender: undefined },
	'birth year not 4 digits': { birth_year: 99 },
	'birth year out of range': { birth_year: 1900 },
	'age negative': { age: -1 },
	'age too high': { age: 200 },
	'age disagrees with birth year': { birth_year: 2540, age: 5 },
	'national id 12 digits': { person_id: { cardType: 'national_id', number: '123456789012' } },
	'national id bad checksum': { person_id: { cardType: 'national_id', number: '1234567890123' } },
	'passport too long': { person_id: { cardType: 'passport', number: 'AB12345678' } },
	'country blank': { country: '' },
	'religion other without text': { religion: 'other', religion_other: '' },
	'emergency contact partial': { emergency_contact: { name: 'สมหญิง', phone: '', relation: '' } },
	'emergency contact name only blank': {
		emergency_contact: { name: '', phone: '0899999999', relation: 'x' }
	}
};

const householdCases: Record<string, Record<string, unknown>> = {
	'address parts missing': { address_no: '', subdistrict: '', district: '', province: '' },
	'homeless without landmark or geo': {
		housing_type: 'homeless',
		address_no: null,
		subdistrict: null,
		district: null,
		province: null
	},
	'dorm without name or room': { housing_type: 'apartment_dorm', address_no: null },
	'pet other without species': { pets: [{ species: 'other', count: 1 }] },
	'one pet group over the cap': { pets: [{ species: 'dog', count: 11 }] },
	'pets over the household cap': {
		pets: [
			{ species: 'dog', count: 6 },
			{ species: 'cat', count: 6 }
		]
	}
};

const batchCases: Record<string, Record<string, unknown>> = {
	'no members': { members: [] },
	'more than 20 members': { members: Array.from({ length: 21 }, () => member()) },
	'join by household and token': { join_household_id: 'h1', join_match_token: 'tok' }
};

const allCases: Record<string, UnifiedRegistrationInput> = {
	...Object.fromEntries(
		Object.entries(memberCases).map(([name, over]) => [name, input({ members: [member(over)] })])
	),
	...Object.fromEntries(
		Object.entries(householdCases).map(([name, over]) => [
			name,
			input({ household: household(over) })
		])
	),
	...Object.fromEntries(Object.entries(batchCases).map(([name, over]) => [name, input(over)]))
};

describe('registration validation messages follow the selected language', () => {
	it('every schema case actually produces an issue (cases stay meaningful)', () => {
		for (const [name, payload] of Object.entries(allCases)) {
			expect(issuesFor(payload).length, name).toBeGreaterThan(0);
		}
	});

	it('en: no registration error message contains Thai text', () => {
		for (const [name, payload] of Object.entries(allCases)) {
			const entries = toRegistrationEntries(issuesFor(payload), 'en');
			expect(entries.length, name).toBeGreaterThan(0);
			for (const entry of entries) {
				expect(entry.message, `${name} -> ${entry.key}`).not.toBe('');
				expect(entry.message, `${name} -> ${entry.key}`).not.toMatch(THAI);
			}
		}
	});

	it('th: messages stay the original Thai text', () => {
		const first = toRegistrationEntries(
			issuesFor(input({ members: [member({ first_name: '' })] })),
			'th'
		);
		expect(first.map((e) => e.message)).toContain('กรุณากรอกชื่อ');
		const defaulted = toRegistrationEntries(
			issuesFor(input({ members: [member({ first_name: '' })] }))
		);
		expect(defaulted).toEqual(first);
		const batch = toRegistrationEntries(issuesFor(input({ members: [] })), 'th');
		expect(batch.map((e) => e.message)).toContain('ต้องมีสมาชิกอย่างน้อย 1 คน');
		expect(localizeRegistrationMessage('กรุณากรอกบ้านเลขที่', 'th')).toBe('กรุณากรอกบ้านเลขที่');
	});

	it('en: the most common errors read as plain English', () => {
		const en = (message: string) => localizeRegistrationMessage(message, 'en');
		expect(en('กรุณากรอกชื่อ')).toBe('Please enter a first name');
		expect(en('เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0')).toBe(
			'Phone number must be 10 digits starting with 0'
		);
		expect(en('เลขที่พาสปอร์ตต้องไม่เกิน 9 ตัวอักษร')).toBe(
			'Passport number must be at most 9 characters'
		);
		expect(en('อายุต้องไม่เกิน 150 ปี')).toBe('Age must not exceed 150 years');
		expect(en('ข้อความที่ไม่รู้จัก')).toBe('ข้อความที่ไม่รู้จัก');
	});

	it('en: keys stay the same as in Thai so live re-validation still matches fields', () => {
		const issues = issuesFor(
			input({ members: [], household: household({ pets: [{ species: 'other' }] }) })
		);
		const th = toRegistrationEntries(issues, 'th').map((e) => e.key);
		const en = toRegistrationEntries(issues, 'en').map((e) => e.key);
		expect(en).toEqual(th);
		// A path-less issue is keyed by its message: the key must use the canonical (Thai) text.
		const formLevel = toRegistrationEntries([{ path: [], message: 'กรุณากรอกชื่อ' }], 'en');
		expect(formLevel[0].key).toBe('form:กรุณากรอกชื่อ');
		expect(formLevel[0].message).toBe('Please enter a first name');
	});
});
