import { describe, it, expect } from 'vitest';
import { managerAccountSpec } from './manager-account';

describe('managerAccountSpec', () => {
	it('builds username, display name, password and manager roles', () => {
		expect(managerAccountSpec('SH001', { name: ' สมชาย ใจดี ', phone: '081-234-5678' })).toEqual({
			name: '0812345678',
			password: '0812345678Sh001/',
			display_name: 'สมชาย ใจดี',
			phone: '0812345678',
			roles: ['shelter:SH001', 'SH001:shelter_manager']
		});
	});

	it('returns null when name or phone is missing', () => {
		expect(managerAccountSpec('SH001', { name: 'สมชาย', phone: '' })).toBeNull();
		expect(managerAccountSpec('SH001', { name: '', phone: '0812345678' })).toBeNull();
		expect(managerAccountSpec('SH001', undefined)).toBeNull();
	});

	it('returns null for a phone that is not a 10-digit mobile', () => {
		expect(managerAccountSpec('SH001', { name: 'สมชาย', phone: '12345' })).toBeNull();
	});
});
