import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authorizeUserWrite, rotateStaffCard, readUserDocForLink, recordAuditedWrites } = vi.hoisted(
	() => ({
		authorizeUserWrite: vi.fn(async () => ({
			name: 'sa',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		})),
		rotateStaffCard: vi.fn(async () => ({
			name: 'staff.a',
			display_name: 'สมชาย ใจดี',
			qr_payload: 'STAFF:secret-token-value'
		})),
		readUserDocForLink: vi.fn<
			(name: string) => Promise<{ display_name?: string; roles?: string[] } | null>
		>(async () => ({
			display_name: 'สมชาย ใจดี',
			roles: ['shelter:SH001', 'registration_staff']
		})),
		recordAuditedWrites: vi.fn(async () => undefined)
	})
);

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	authorizeUserWrite
}));
vi.mock('$lib/server/staff-card-service', () => ({ rotateStaffCard }));
vi.mock('$lib/server/user-service', () => ({ readUserDocForLink }));
vi.mock('$lib/server/audit-log', () => ({ recordAuditedWrites }));

import { ServiceError } from '$lib/server/couch-admin';
import { POST } from './+server';

function call(body?: unknown): Parameters<typeof POST>[0] {
	const request = new Request('http://localhost/api/v1/users/staff-card/rotate', {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	return { request } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	authorizeUserWrite.mockResolvedValue({
		name: 'sa',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	rotateStaffCard.mockResolvedValue({
		name: 'staff.a',
		display_name: 'สมชาย ใจดี',
		qr_payload: 'STAFF:secret-token-value'
	});
	readUserDocForLink.mockResolvedValue({
		display_name: 'สมชาย ใจดี',
		roles: ['shelter:SH001', 'registration_staff']
	});
});

describe('POST /api/v1/users/staff-card/rotate — CR-260 FR-C26', () => {
	it('records user.staff_card_rotated with scoped shelter codes and no card token', async () => {
		const res = await POST(call({ name: 'staff.a' }));

		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(recordAuditedWrites).toHaveBeenCalledTimes(1);
		expect(recordAuditedWrites).toHaveBeenCalledWith(
			{
				actor: 'sa',
				event: 'user.staff_card_rotated',
				action: 'update',
				entityType: 'user',
				entityId: 'staff.a',
				label: 'สมชาย ใจดี'
			},
			['SH001']
		);
		expect(JSON.stringify(recordAuditedWrites.mock.calls[0])).not.toContain('secret-token-value');
	});

	it('returns 422 and records nothing when name is missing or blank', async () => {
		const res = await POST(call({ name: '   ' }));

		expect(res.status).toBe(422);
		expect(rotateStaffCard).not.toHaveBeenCalled();
		expect(recordAuditedWrites).not.toHaveBeenCalled();
	});

	it('records nothing when rotateStaffCard fails', async () => {
		rotateStaffCard.mockRejectedValueOnce(new ServiceError('FORBIDDEN', 'ไม่รับผิดชอบศูนย์นี้'));

		const res = await POST(call({ name: 'staff.a' }));

		expect(res.status).toBe(403);
		expect(recordAuditedWrites).not.toHaveBeenCalled();
	});

	it('still succeeds and falls back to null label/shelter if user lookup fails', async () => {
		readUserDocForLink.mockRejectedValueOnce(new Error('lookup failed'));

		const res = await POST(call({ name: 'staff.a' }));

		expect(res.status).toBe(200);
		expect(recordAuditedWrites).toHaveBeenCalledWith(
			{
				actor: 'sa',
				event: 'user.staff_card_rotated',
				action: 'update',
				entityType: 'user',
				entityId: 'staff.a',
				label: null
			},
			[null]
		);
	});
});
