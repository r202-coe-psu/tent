import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelDonation } from './public-tracking';

function mockFetch(status: number, body: unknown = {}) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body)
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('cancelDonation', () => {
	it('DELETEs the token-scoped BFF route', async () => {
		const fetchMock = mockFetch(200, { success: true });

		await cancelDonation('tok/en 1');

		expect(fetchMock).toHaveBeenCalledWith('/api/public/v1/donations/tok%2Fen%201', {
			method: 'DELETE'
		});
	});

	it('maps a 409 sync conflict to donor-facing retry copy', async () => {
		mockFetch(409, { success: false, error: 'Donation is syncing.' });

		await expect(cancelDonation('tok')).rejects.toThrow('กำลังบันทึกเข้าระบบ');
	});

	it('maps a 400 status refusal to donor-facing copy', async () => {
		mockFetch(400, { success: false, error: 'Cannot cancel donation in status "verifying"' });

		await expect(cancelDonation('tok')).rejects.toThrow('ยกเลิกไม่ได้แล้ว');
	});

	it('maps rate limiting to a wait message', async () => {
		mockFetch(429, { success: false, error: 'RATE_LIMITED' });

		await expect(cancelDonation('tok')).rejects.toThrow('บ่อยเกินไป');
	});
});
