import { describe, expect, it } from 'vitest';
import {
	formatStaffToken,
	isValidStaffTokenHash,
	isStaffCardScanCode,
	parseStaffCardPayload,
	staffCardFileName,
	staffCardText,
	staffCardPayloadFromHash,
	staffCardRoleLabel,
	staffRecipientId,
	userNameFromStaffRecipientId
} from './staff-card';

describe('formatStaffToken', () => {
	it('renders 16 bytes as the TKT-STF- prefix plus 32 uppercase hex digits', () => {
		const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
		expect(formatStaffToken(bytes)).toBe('TKT-STF-000102030405060708090A0B0C0D0E0F');
	});

	it('rejects a byte array that is not exactly 16 bytes', () => {
		expect(() => formatStaffToken(new Uint8Array(15))).toThrow(RangeError);
		expect(() => formatStaffToken(new Uint8Array(17))).toThrow(RangeError);
	});
});

describe('isValidStaffTokenHash', () => {
	it('accepts exactly 64 lowercase hex digits', () => {
		expect(isValidStaffTokenHash('0123456789abcdef'.repeat(4))).toBe(true);
	});

	it('rejects uppercase, wrong length, non-hex and non-strings', () => {
		expect(isValidStaffTokenHash('0123456789ABCDEF'.repeat(4))).toBe(false);
		expect(isValidStaffTokenHash('a'.repeat(63))).toBe(false);
		expect(isValidStaffTokenHash('a'.repeat(65))).toBe(false);
		expect(isValidStaffTokenHash('g'.repeat(64))).toBe(false);
		expect(isValidStaffTokenHash(`${'a'.repeat(64)}\n`)).toBe(false);
		expect(isValidStaffTokenHash(undefined)).toBe(false);
		expect(isValidStaffTokenHash(42)).toBe(false);
	});
});

const HASH = '0123456789abcdef'.repeat(4);

describe('isStaffCardScanCode', () => {
	it.each([`TKT-STF-HASH-${HASH}`, 'tkt-stf-hash-oops', ' TKT-STF-1234 '])(
		'treats %s as a staff card',
		(code) => {
			expect(isStaffCardScanCode(code)).toBe(true);
		}
	);

	it.each(['TKT-VOL-ABC123', 'EVAC-0001', 'TKT-STX-1'])(
		'does not treat %s as a staff card',
		(code) => {
			expect(isStaffCardScanCode(code)).toBe(false);
		}
	);
});

describe('parseStaffCardPayload', () => {
	it('reads the hash from a bare staff card payload', () => {
		expect(parseStaffCardPayload(`TKT-STF-HASH-${HASH}`)).toEqual({ hash: HASH });
	});

	it('reads the hash from a payload inside a URL path', () => {
		expect(
			parseStaffCardPayload(`https://shelter.example/distribution/TKT-STF-HASH-${HASH}`)
		).toEqual({
			hash: HASH
		});
	});

	it('lowercases an uppercase prefix and hash', () => {
		expect(parseStaffCardPayload(`tkt-stf-hash-${HASH.toUpperCase()}`)).toEqual({ hash: HASH });
		expect(parseStaffCardPayload(`  Tkt-Stf-Hash-${HASH.toUpperCase()}  `)).toEqual({ hash: HASH });
	});

	it('rejects garbage, short hashes, blanks, volunteer payloads and plaintext staff tokens', () => {
		expect(parseStaffCardPayload('hello')).toBeNull();
		expect(parseStaffCardPayload('   ')).toBeNull();
		expect(parseStaffCardPayload('TKT-STF-HASH-abc123')).toBeNull();
		expect(parseStaffCardPayload(`TKT-STF-HASH-${'g'.repeat(64)}`)).toBeNull();
		expect(parseStaffCardPayload(`TKT-VOL-HASH-${HASH}`)).toBeNull();
		expect(parseStaffCardPayload('evacuee:01HZXEVAC')).toBeNull();
		expect(parseStaffCardPayload('TKT-STF-000102030405060708090A0B0C0D0E0F')).toBeNull();
	});
});

describe('staffCardPayloadFromHash', () => {
	it('prefixes the hash with TKT-STF-HASH- and parses back to the same hash', () => {
		const payload = staffCardPayloadFromHash(HASH);
		expect(payload).toBe(`TKT-STF-HASH-${HASH}`);
		expect(parseStaffCardPayload(payload)).toEqual({ hash: HASH });
	});
});

describe('staffRecipientId', () => {
	it('prefixes the CouchDB user name with user: and maps back to it', () => {
		expect(staffRecipientId('somchai')).toBe('user:somchai');
		expect(userNameFromStaffRecipientId('user:somchai')).toBe('somchai');
	});

	it('rejects ids that are not user: recipients or have an empty name', () => {
		expect(userNameFromStaffRecipientId('volunteer:01HZXVOL')).toBeNull();
		expect(userNameFromStaffRecipientId('evacuee:01HZXEVAC')).toBeNull();
		expect(userNameFromStaffRecipientId('somchai')).toBeNull();
		expect(userNameFromStaffRecipientId('user:')).toBeNull();
	});
});

describe('staffCardRoleLabel', () => {
	it('labels a system admin as central admin whatever the shelter', () => {
		expect(staffCardRoleLabel(['system_admin'], null)).toBe('ผู้ดูแลระบบส่วนกลาง');
		expect(staffCardRoleLabel(['system_admin', 'shelter:SH001'], 'SH001')).toBe(
			'ผู้ดูแลระบบส่วนกลาง'
		);
	});

	it('lists the compound capabilities held in the given shelter, joined with a middle dot', () => {
		const roles = [
			'shelter:SH001',
			'SH001:kitchen_staff',
			'SH001:registration_staff',
			'shelter:SH002',
			'SH002:medical_staff'
		];
		expect(staffCardRoleLabel(roles, 'SH001')).toBe('เจ้าหน้าที่ลงทะเบียน · เจ้าหน้าที่ครัว');
		expect(staffCardRoleLabel(roles, 'SH002')).toBe('เจ้าหน้าที่การแพทย์และพยาบาล');
	});

	it('puts the shelter manager label first', () => {
		const roles = ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:shelter_manager'];
		expect(staffCardRoleLabel(roles, 'SH001')).toBe('ผู้จัดการศูนย์ · เจ้าหน้าที่ครัว');
	});

	it('counts a legacy bare capability only when the user has exactly one shelter', () => {
		expect(staffCardRoleLabel(['shelter:SH001', 'security_officer'], 'SH001')).toBe(
			'เจ้าหน้าที่รักษาความปลอดภัย'
		);
		expect(
			staffCardRoleLabel(['shelter:SH001', 'shelter:SH002', 'security_officer'], 'SH001')
		).toBe('เจ้าหน้าที่');
	});

	it('falls back to generic staff when no capability applies to the shelter', () => {
		expect(staffCardRoleLabel(['shelter:SH001', 'SH001:kitchen_staff'], 'SH009')).toBe(
			'เจ้าหน้าที่'
		);
		expect(staffCardRoleLabel(['shelter:SH001', 'SH001:kitchen_staff'], null)).toBe('เจ้าหน้าที่');
		expect(staffCardRoleLabel([], null)).toBe('เจ้าหน้าที่');
	});

	it('ignores a compound capability for a shelter the user has no scope in', () => {
		expect(staffCardRoleLabel(['SH001:kitchen_staff'], 'SH001')).toBe('เจ้าหน้าที่');
	});
});

describe('staffCardText', () => {
	it('badges every staff card as generic staff with no role lines, however many roles they hold', () => {
		expect(staffCardText({})).toEqual({ badge: 'เจ้าหน้าที่', lines: [] });
		expect(staffCardText({ volunteerCode: null })).toEqual({ badge: 'เจ้าหน้าที่', lines: [] });
	});

	it('badges a volunteer card as volunteer with its code', () => {
		expect(staffCardText({ volunteerCode: 'V-0012' })).toEqual({
			badge: 'จิตอาสา',
			lines: ['รหัสจิตอาสา V-0012']
		});
	});
});

describe('staffCardFileName', () => {
	it('keeps Thai vowel and tone marks so the name stays readable', () => {
		expect(staffCardFileName('สิทธิ์ ประดิษฐ์')).toBe('staff-card-สิทธิ์-ประดิษฐ์.png');
	});

	it('joins words with one hyphen and drops symbols at the edges', () => {
		expect(staffCardFileName('  Somchai (Staff 01)  ')).toBe('staff-card-Somchai-Staff-01.png');
	});

	it('falls back to a generic name when nothing printable is left', () => {
		expect(staffCardFileName(' -- ')).toBe('staff-card-card.png');
	});
});
