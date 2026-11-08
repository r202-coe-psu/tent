import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import * as couchAdmin from '$lib/server/couch-admin';
import { ServiceError } from '$lib/server/couch-admin';
import * as service from '$lib/server/evacuee-qr-service';

vi.mock('$lib/server/evacuee-qr-service', () => ({ issueEvacueeQr: vi.fn() }));

const ID_A = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0';
const ID_B = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH1';

const staff = {
	name: 'staff01',
	roles: ['shelter:SH001', 'SH001:registration_staff'],
	isSA: false,
	shelterCode: 'SH001'
};

const call = (body: unknown) =>
	POST({
		request: new Request('http://x/api/v1/evacuee-qr/issue', {
			method: 'POST',
			headers: { cookie: 'AuthSession=abc' },
			body: JSON.stringify(body)
		})
	} as unknown as RequestEvent);

const good = { shelter_code: 'SH001', source: 'profile', evacuee_ids: [ID_A] };

describe('POST /api/v1/evacuee-qr/issue', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(service.issueEvacueeQr).mockReset();
		vi.spyOn(couchAdmin, 'authorizeSession').mockResolvedValue(staff);
	});

	it('401 without a session', async () => {
		vi.spyOn(couchAdmin, 'authorizeSession').mockRejectedValue(
			new ServiceError('UNAUTHENTICATED', 'Authentication required')
		);
		expect((await call(good)).status).toBe(401);
	});

	it('403 for a shelter the caller has no scope in', async () => {
		const res = await call({ ...good, shelter_code: 'SH002' });
		expect(res.status).toBe(403);
		expect(service.issueEvacueeQr).not.toHaveBeenCalled();
	});

	it.each([
		['kitchen_staff', ['shelter:SH001', 'SH001:kitchen_staff']],
		['distribution_staff', ['shelter:SH001', 'SH001:distribution_staff']],
		['scope only, no capability', ['shelter:SH001']],
		['registration_staff of another shelter', ['shelter:SH002', 'SH002:registration_staff']]
	])('403 for %s in SH001', async (_n, roles) => {
		vi.spyOn(couchAdmin, 'authorizeSession').mockResolvedValue({ ...staff, roles });
		const res = await call(good);
		expect(res.status).toBe(403);
		expect(service.issueEvacueeQr).not.toHaveBeenCalled();
	});

	it.each([
		['shelter_manager', ['shelter:SH001', 'SH001:shelter_manager']],
		['system_admin', ['system_admin']]
	])('allows %s', async (_n, roles) => {
		vi.spyOn(couchAdmin, 'authorizeSession').mockResolvedValue({ ...staff, roles });
		vi.mocked(service.issueEvacueeQr).mockResolvedValue({
			evacuee_id: ID_A,
			qr_payload: `${ID_A}@abcdef`,
			printed_at: 't1'
		});
		expect((await call(good)).status).toBe(200);
	});

	it.each([
		['bad source', { ...good, source: 'kiosk_checkin' }],
		['empty ids', { ...good, evacuee_ids: [] }],
		['31 ids', { ...good, evacuee_ids: Array.from({ length: 31 }, (_, i) => `evacuee:${i}`) }],
		['duplicate ids', { ...good, evacuee_ids: [ID_A, ID_A] }],
		['no shelter', { ...good, shelter_code: '' }]
	])('422 for %s', async (_n, body) => {
		expect((await call(body)).status).toBe(422);
	});

	it('issues per id with printed_by from the session, reporting per-item status', async () => {
		vi.mocked(service.issueEvacueeQr)
			.mockResolvedValueOnce({ evacuee_id: ID_A, qr_payload: `${ID_A}@abcdef`, printed_at: 't1' })
			.mockRejectedValueOnce(new ServiceError('NOT_FOUND', 'Evacuee not found'));
		const res = await call({ ...good, source: 'family_batch', evacuee_ids: [ID_A, ID_B] });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			items: [
				{ evacuee_id: ID_A, status: 'issued', qr_payload: `${ID_A}@abcdef`, printed_at: 't1' },
				{ evacuee_id: ID_B, status: 'not_found' }
			]
		});
		expect(service.issueEvacueeQr).toHaveBeenCalledWith({
			shelter_code: 'SH001',
			evacuee_id: ID_A,
			source: 'family_batch',
			printed_by: 'staff01'
		});
	});

	it('marks an item failed when issuing throws CONFLICT', async () => {
		vi.mocked(service.issueEvacueeQr).mockRejectedValue(new ServiceError('CONFLICT', 'x'));
		const body = await (await call(good)).json();
		expect(body.items).toEqual([{ evacuee_id: ID_A, status: 'failed' }]);
	});
});
