import { describe, it, expect } from 'vitest';
import {
	affiliationTagsFor,
	createUserSchema,
	editUserSchema,
	isVolunteerAccount,
	toDateTimeLocal,
	toDutyWindow,
	PLATFORM_WIDE,
	VOLUNTEER_TAG
} from './schema';

const validPassword = 'SecurePass1!';

describe('createUserSchema', () => {
	it('accepts a system_admin grant without a shelter', () => {
		const parsed = createUserSchema.parse({
			username: 'sa02',
			password: validPassword,
			display_name: 'ผู้ดูแลระบบ',
			capability: 'system_admin'
		});
		expect(parsed.capability).toBe('system_admin');
		expect(parsed.shelter_id).toBeUndefined();
	});

	it('accepts a shelter-scoped staff grant with a shelter code', () => {
		const parsed = createUserSchema.parse({
			username: 'staff99',
			password: validPassword,
			display_name: 'เจ้าหน้าที่',
			capability: 'registration_staff',
			shelter_id: 'SH001'
		});
		expect(parsed.shelter_id).toBe('SH001');
	});

	it('rejects an unknown capability', () => {
		const result = createUserSchema.safeParse({
			username: 'staff99',
			password: validPassword,
			display_name: 'เจ้าหน้าที่',
			capability: '_admin'
		});
		expect(result.success).toBe(false);
	});

	it('rejects a malformed shelter code', () => {
		const result = createUserSchema.safeParse({
			username: 'staff99',
			password: validPassword,
			display_name: 'เจ้าหน้าที่',
			capability: 'registration_staff',
			shelter_id: 'not-a-code'
		});
		expect(result.success).toBe(false);
	});
});

describe('editUserSchema', () => {
	it('allows an empty password (unchanged)', () => {
		const parsed = editUserSchema.parse({
			username: 'sa02',
			password: '',
			display_name: 'ผู้ดูแลระบบ',
			capability: 'system_admin'
		});
		expect(parsed.password).toBe('');
	});
});

// --- CR-096 -----------------------------------------------------------------

describe('CR-096 personnel type + duty window', () => {
	const base = {
		username: 'staff99',
		password: validPassword,
		display_name: 'เจ้าหน้าที่',
		capability: 'registration_staff' as const,
		shelter_id: 'SH001'
	};

	it('defaults an account to staff and active when the caller omits both', () => {
		const parsed = createUserSchema.parse(base);
		expect(parsed.personnel_type).toBe('staff');
		expect(parsed.active).toBe(true);
	});

	it('accepts one of the CR-096 capabilities that RBAC does not enforce yet', () => {
		const parsed = createUserSchema.parse({ ...base, capability: 'volunteer_coordinator' });
		expect(parsed.capability).toBe('volunteer_coordinator');
	});

	it('accepts a duty window given as a complete, forward-running pair', () => {
		const parsed = createUserSchema.parse({
			...base,
			duty_start: '2026-08-29T08:00',
			duty_end: '2026-08-29T16:00'
		});
		expect(parsed.duty_start).toBe('2026-08-29T08:00');
	});

	it('rejects a half-filled duty window', () => {
		const result = createUserSchema.safeParse({ ...base, duty_start: '2026-08-29T08:00' });
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.path).toEqual(['duty_end']);
	});

	it('rejects a duty window that ends before it starts', () => {
		const result = createUserSchema.safeParse({
			...base,
			duty_start: '2026-08-29T16:00',
			duty_end: '2026-08-29T08:00'
		});
		expect(result.success).toBe(false);
	});

	it('allows platform-wide affiliation only for system_admin', () => {
		expect(
			createUserSchema.safeParse({
				...base,
				capability: 'system_admin',
				shelter_id: PLATFORM_WIDE
			}).success
		).toBe(true);
		const scoped = createUserSchema.safeParse({ ...base, shelter_id: PLATFORM_WIDE });
		expect(scoped.success).toBe(false);
		expect(scoped.error?.issues[0]?.path).toEqual(['shelter_id']);
	});
});

describe('affiliationTagsFor', () => {
	it('tags a volunteer account and leaves a staff account untagged (R-AFFIL-1/2)', () => {
		expect(affiliationTagsFor('volunteer')).toEqual([VOLUNTEER_TAG]);
		expect(affiliationTagsFor('staff')).toEqual([]);
	});

	it('preserves tags the form does not own', () => {
		expect(affiliationTagsFor('volunteer', ['governance'])).toEqual(['governance', VOLUNTEER_TAG]);
		expect(affiliationTagsFor('staff', ['governance', VOLUNTEER_TAG])).toEqual(['governance']);
	});

	it('does not duplicate the tag when re-saving a volunteer', () => {
		expect(affiliationTagsFor('volunteer', [VOLUNTEER_TAG])).toEqual([VOLUNTEER_TAG]);
	});

	it('reads the badge from the tag, never from the RoleKey (R-AFFIL-3/5)', () => {
		expect(isVolunteerAccount([VOLUNTEER_TAG])).toBe(true);
		expect(isVolunteerAccount(['volunteer_coordinator'])).toBe(false);
		expect(isVolunteerAccount(undefined)).toBe(false);
	});
});

describe('duty window conversion', () => {
	it('round-trips a local datetime through the stored ISO instant', () => {
		const window = toDutyWindow('2026-08-29T08:00', '2026-08-29T16:00');
		expect(window).not.toBeNull();
		expect(toDateTimeLocal(window?.start_ts)).toBe('2026-08-29T08:00');
		expect(toDateTimeLocal(window?.end_ts)).toBe('2026-08-29T16:00');
	});

	it('is null when either end is blank — that means permanent access', () => {
		expect(toDutyWindow('2026-08-29T08:00', undefined)).toBeNull();
		expect(toDutyWindow(undefined, undefined)).toBeNull();
	});

	it('renders an empty string for a missing or unparseable instant', () => {
		expect(toDateTimeLocal(null)).toBe('');
		expect(toDateTimeLocal('not-a-date')).toBe('');
	});
});
