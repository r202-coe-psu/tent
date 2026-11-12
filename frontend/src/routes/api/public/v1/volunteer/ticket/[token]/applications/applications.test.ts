import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { listTicketApplications } from '$lib/features/volunteers/server/public-ticket';

type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/features/volunteers/server/public-ticket', () => ({
	listTicketApplications: vi.fn()
}));

describe('GET /api/public/v1/volunteer/ticket/[token]/applications (#973)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	function makeEvent(token?: string): GetEvent {
		return {
			params: { token: token as string },
			url: new URL(`http://localhost/api/public/v1/volunteer/ticket/${token ?? ''}/applications`)
		} as unknown as GetEvent;
	}

	it('returns 404 TICKET_NOT_FOUND when token param is empty', async () => {
		const res = await GET(makeEvent('   '));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({ success: false, error: 'TICKET_NOT_FOUND' });
	});

	it('returns 404 TICKET_NOT_FOUND when token is not recognized', async () => {
		vi.mocked(listTicketApplications).mockResolvedValueOnce(null);
		const res = await GET(makeEvent('unknown-token'));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({ success: false, error: 'TICKET_NOT_FOUND' });
	});

	it('returns 503 LOOKUP_FAILED when lookup encounters database error', async () => {
		vi.mocked(listTicketApplications).mockRejectedValueOnce(new Error('CouchDB unreachable'));
		const res = await GET(makeEvent('valid-token'));
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body).toEqual({ success: false, error: 'LOOKUP_FAILED' });
	});

	it('returns 200 with applications and Cache-Control: no-store header', async () => {
		const mockApps = [
			{
				application_id: 'app:1',
				status: 'confirmed',
				job_id: 'job:1',
				shift_id: 'shift:1',
				date: '2026-12-01',
				can_cancel: true
			}
		];
		vi.mocked(listTicketApplications).mockResolvedValueOnce(mockApps);

		const res = await GET(makeEvent('valid-token'));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = await res.json();
		expect(body).toEqual({ success: true, applications: mockApps });
	});
});
