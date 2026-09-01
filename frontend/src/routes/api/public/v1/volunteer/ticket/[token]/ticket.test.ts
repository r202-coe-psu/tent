import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { volunteerTicketLimiter } from '$lib/server/security/rate-limiter';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerTicketLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: ''
	}
}));

describe('GET /api/public/v1/volunteer/ticket/[token]', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(volunteerTicketLimiter.check).mockReturnValue(true);
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

		// 2. Direct doc GET in shelter_sh001
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
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
		expect(json.ticket.job_title).toBe('ทีมอำนวยการและต้อนรับผู้ประสานงาน EOC ม.อ.');
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
