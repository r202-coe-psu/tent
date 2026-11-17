import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceError } from '$lib/server/couch-admin';

vi.mock('$lib/server/user-service', () => ({ createUser: vi.fn() }));

import { createUser } from '$lib/server/user-service';
import { provisionShelterManager } from './manager-account';

const createUserMock = vi.mocked(createUser);
const contact = { name: 'สมชาย ใจดี', phone: '0812345678' };

beforeEach(() => {
	createUserMock.mockReset();
});

describe('provisionShelterManager', () => {
	it('creates a shelter_manager login from the contact', async () => {
		createUserMock.mockResolvedValue();
		expect(await provisionShelterManager('SH001', contact)).toEqual({
			status: 'created',
			username: '0812345678'
		});
		expect(createUserMock).toHaveBeenCalledWith(
			expect.objectContaining({
				name: '0812345678',
				password: '0812345678Sh001/',
				display_name: 'สมชาย ใจดี',
				roles: ['shelter:SH001', 'SH001:shelter_manager'],
				must_change_password: true
			})
		);
	});

	it('skips when the contact is incomplete', async () => {
		expect(await provisionShelterManager('SH001', { name: 'สมชาย' })).toEqual({
			status: 'skipped'
		});
		expect(createUserMock).not.toHaveBeenCalled();
	});

	it('reports an existing account instead of throwing', async () => {
		createUserMock.mockImplementation(async () => {
			throw new ServiceError('CONFLICT', 'exists');
		});
		expect(await provisionShelterManager('SH001', contact)).toEqual({
			status: 'exists',
			message: 'exists'
		});
	});

	it('reports other failures instead of throwing', async () => {
		createUserMock.mockImplementation(async () => {
			throw new Error('boom');
		});
		expect(await provisionShelterManager('SH001', contact)).toEqual({
			status: 'failed',
			message: 'boom'
		});
	});
});
