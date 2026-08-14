import { describe, it, expect } from 'vitest';
import { createUserSchema, editUserSchema } from './schema';

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
