import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { adminRaw } = vi.hoisted(() => ({ adminRaw: vi.fn() }));
vi.mock('./couch-admin', () => ({ adminRaw }));

import { AUDIT_WRITE_ATTEMPTS, recordRoleGrantAudit } from './role-grant-audit';

const INPUT = {
	shelter_code: 'SH001',
	user_name: 'vol@example.com',
	reason: 'role_grant.renewed' as const,
	role: 'kitchen_staff',
	expires_at: '2026-11-03T16:59:59.999Z',
	previous_expires_at: '2026-10-31T16:59:59.999Z',
	actor: 'staff03'
};

describe('recordRoleGrantAudit (FR-14)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		adminRaw.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('writes an append-only audit doc into the shelter database', async () => {
		adminRaw.mockResolvedValue({ status: 201, data: { ok: true } });
		await expect(recordRoleGrantAudit(INPUT)).resolves.toBe(true);
		const [path, method, doc] = adminRaw.mock.calls[0];
		expect(method).toBe('PUT');
		expect(path).toMatch(/^\/shelter_sh001\/audit%3A[0-9A-Z]{26}$/);
		expect(doc).toMatchObject({
			type: 'audit',
			schema_v: 1,
			shelter_code: 'SH001',
			created_by: 'staff03',
			action: 'other',
			target_type: 'user',
			target_id: 'org.couchdb.user:vol@example.com',
			reason: 'role_grant.renewed',
			context: {
				role: 'kitchen_staff',
				expires_at: INPUT.expires_at,
				previous_expires_at: INPUT.previous_expires_at,
				actor: 'staff03'
			}
		});
		expect(doc.occurred_at).toBe(doc.created_at);
	});

	it('leaves previous_expires_at out when there was none', async () => {
		adminRaw.mockResolvedValue({ status: 201, data: {} });
		await recordRoleGrantAudit({ ...INPUT, previous_expires_at: undefined });
		expect(adminRaw.mock.calls[0][2].context).not.toHaveProperty('previous_expires_at');
	});

	it('records the verified profile and its verifier when the change carries one', async () => {
		adminRaw.mockResolvedValue({ status: 201, data: {} });
		const verified_by = {
			shelter_code: 'SH001',
			volunteer_id: 'volunteer:V1',
			reviewed_by: 'staff03'
		};
		await recordRoleGrantAudit({ ...INPUT, verified_by });
		expect(adminRaw.mock.calls[0][2].context.verified_by).toEqual(verified_by);
	});

	it('leaves verified_by out when the change carries none', async () => {
		adminRaw.mockResolvedValue({ status: 201, data: {} });
		await recordRoleGrantAudit(INPUT);
		expect(adminRaw.mock.calls[0][2].context).not.toHaveProperty('verified_by');
	});

	it('retries with the same _id and counts a conflict as written', async () => {
		adminRaw
			.mockResolvedValueOnce({ status: 500, data: null })
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
		const done = recordRoleGrantAudit(INPUT);
		await vi.runAllTimersAsync();
		await expect(done).resolves.toBe(true);
		expect(adminRaw).toHaveBeenCalledTimes(3);
		expect(new Set(adminRaw.mock.calls.map((c) => c[0])).size).toBe(1);
	});

	it('logs the audit fields and does not throw once the attempts are used up', async () => {
		adminRaw.mockResolvedValue({ status: 500, data: null });
		const done = recordRoleGrantAudit(INPUT);
		await vi.runAllTimersAsync();
		await expect(done).resolves.toBe(false);
		expect(adminRaw).toHaveBeenCalledTimes(AUDIT_WRITE_ATTEMPTS);
		expect(console.error).toHaveBeenCalledWith(
			'[role-grant-audit] audit not written',
			expect.objectContaining({
				shelter_code: 'SH001',
				target_id: 'org.couchdb.user:vol@example.com',
				reason: 'role_grant.renewed',
				context: expect.objectContaining({ role: 'kitchen_staff', actor: 'staff03' })
			})
		);
	});
});
