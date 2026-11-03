import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: ''
	}
}));

describe('GET /api/public/v1/volunteer/ticket/[token]', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	function makeEvent(token: string): GetEvent {
		return {
			params: { token },
			fetch: vi.fn().mockRejectedValue(new Error('no fastapi')),
			getClientAddress: () => '127.0.0.1'
		} as unknown as GetEvent;
	}

	it('returns ticket details when found in shelter_sh001', async () => {
		const adminRawMock = vi.mocked(adminRaw);

		// 1. Registry query -> 404/empty
		adminRawMock.mockResolvedValueOnce({ status: 404, data: {} });

		// 2. Search job_application by tracking_token via _find in shelter_sh001
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				docs: [
					{
						_id: 'job_application:app_01m1ceqt8vwxgzrmks1ybmk6v2',
						type: 'job_application',
						tracking_token: 'app_01m1ceqt8vwxgzrmks1ybmk6v2',
						job_id: 'job:job-1',
						status: 'pending_review',
						applicant: {
							first_name: 'สมชาย',
							last_name: 'ใจดี',
							phone: '0812345678'
						},
						selected_shift: {
							date: '2026-06-13',
							start_time: '08:00',
							end_time: '12:00'
						},
						created_at: '2026-06-12T10:00:00Z'
					}
				]
			}
		});

		// 3. Job title lookup
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'job:job-1',
				type: 'job',
				title: 'ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.'
			}
		});

		const res = await GET(makeEvent('app_01m1ceqt8vwxgzrmks1ybmk6v2'));
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.ticket.token).toBe('app_01m1ceqt8vwxgzrmks1ybmk6v2');
		expect(json.ticket.applicant_name).toBe('สมชาย ใจดี');
		// 2026-06-13 08:00 is long past, so the pass must not offer cancel.
		expect(json.ticket.can_cancel).toBe(false);
		expect(json.ticket.job_title).toBe('ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.');
		const appQuery = adminRawMock.mock.calls[1]?.[2] as {
			selector?: { $or?: Record<string, string>[] };
		};
		expect(appQuery.selector?.$or).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ tracking_token: 'app_01m1ceqt8vwxgzrmks1ybmk6v2' }),
				expect.objectContaining({ tracking_token_hash: expect.any(String) })
			])
		);
		expect(appQuery.selector?.$or?.some((selector) => '_id' in selector)).toBe(false);
	});

	describe('can_cancel for an application cancelled with its quota release still due (CR-220 FR-7)', () => {
		const cancelledApp = (extra: Record<string, unknown>) => ({
			_id: 'job_application:app_resume',
			type: 'job_application',
			tracking_token: 'app_resume',
			job_id: 'job:job-1',
			status: 'cancelled',
			applicant: { first_name: 'สมชาย', last_name: 'ใจดี', phone: '0812345678' },
			// Long past: a normal cancel would be refused, resuming a release is not.
			selected_shift: { date: '2026-06-13', start_time: '08:00', end_time: '12:00' },
			created_at: '2026-06-12T10:00:00Z',
			...extra
		});

		async function canCancel(app: Record<string, unknown>) {
			const adminRawMock = vi.mocked(adminRaw);
			adminRawMock.mockResolvedValueOnce({ status: 404, data: {} });
			adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [app] } });
			adminRawMock.mockResolvedValueOnce({ status: 200, data: { title: 'งานทดสอบ' } });
			const res = await GET(makeEvent('app_resume'));
			expect(res.status).toBe(200);
			return (await res.json()).ticket as { can_cancel: boolean; status: string };
		}

		it('is true while the release is due, so the pass offers the button again after a refresh', async () => {
			const ticket = await canCancel(
				cancelledApp({ quota_release_due_at: '2026-06-12T11:00:00Z' })
			);
			expect(ticket.status).toBe('cancelled');
			expect(ticket.can_cancel).toBe(true);
		});

		it('is false once the quota was released', async () => {
			const ticket = await canCancel(
				cancelledApp({
					quota_release_due_at: '2026-06-12T11:00:00Z',
					quota_released_at: '2026-06-12T11:00:01Z'
				})
			);
			expect(ticket.can_cancel).toBe(false);
		});

		it('is false for any other cancelled application', async () => {
			expect((await canCancel(cancelledApp({}))).can_cancel).toBe(false);
		});
		it("shows the application still owed its quota on a volunteer's permanent token, ahead of an upcoming one", async () => {
			const adminRawMock = vi.mocked(adminRaw);
			const upcoming = {
				...cancelledApp({}),
				_id: 'job_application:app_upcoming',
				tracking_token: 'app_upcoming',
				status: 'confirmed',
				selected_shift: { date: '2099-01-01', start_time: '08:00', end_time: '12:00' }
			};
			const owed = cancelledApp({ quota_release_due_at: '2026-06-12T11:00:00Z' });
			adminRawMock.mockResolvedValueOnce({ status: 404, data: {} });
			adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [] } });
			adminRawMock.mockResolvedValueOnce({
				status: 200,
				data: { docs: [{ _id: 'volunteer:v1', type: 'volunteer' }] }
			});
			adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [upcoming, owed] } });
			adminRawMock.mockResolvedValue({ status: 200, data: { title: 'งานทดสอบ' } });

			const res = await GET(makeEvent('TKT-VOL-PERMANENT'));
			expect(res.status).toBe(200);
			const ticket = (await res.json()).ticket as { application_id: string; can_cancel: boolean };
			expect(ticket.application_id).toBe('job_application:app_resume');
			expect(ticket.can_cancel).toBe(true);
		});
	});

	it('does not treat an internal CouchDB document id as a public ticket credential', async () => {
		const adminRawMock = vi.mocked(adminRaw);
		adminRawMock.mockResolvedValueOnce({ status: 404, data: {} });
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [] } });
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [] } });

		const res = await GET(makeEvent('job_application:app_known-internal-id'));

		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('TICKET_NOT_FOUND');
		const appQuery = adminRawMock.mock.calls[1]?.[2] as {
			selector?: { $or?: Record<string, string>[] };
		};
		expect(appQuery.selector?.$or?.some((selector) => '_id' in selector)).toBe(false);
	});

	it('returns 404 when token is not found in any shelter database', async () => {
		const adminRawMock = vi.mocked(adminRaw);

		// Registry
		adminRawMock.mockResolvedValueOnce({ status: 404, data: {} });
		// shelter_sh001 doc GET
		adminRawMock.mockResolvedValueOnce({ status: 404, data: {} });
		// shelter_sh001 _find
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [] } });

		const res = await GET(makeEvent('app_nonexistent'));
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.success).toBe(false);
		expect(json.error).toBe('TICKET_NOT_FOUND');
	});
});
