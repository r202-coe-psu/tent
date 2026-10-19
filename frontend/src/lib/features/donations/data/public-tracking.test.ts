import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cancelDonation,
	DonationLookupCaptchaError,
	lookupDonationsByPhone
} from './public-tracking';

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

describe('lookupDonationsByPhone', () => {
	const item = {
		tracking_token: 'TX-SH001-ABC',
		booking_ref: 'DN-100001',
		status: 'pending_review',
		shelter_code: 'SH001',
		item_count: 1,
		created_at: '2026-10-19T10:00:00+00:00'
	};

	it('POSTs the phone in the body, never the URL (CR-173 FR-1)', async () => {
		const fetchMock = mockFetch(200, { success: true, items: [item] });

		expect(await lookupDonationsByPhone({ phone: ' 0812345678 ' })).toEqual([item]);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/public/v1/donations/lookup-by-phone');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ phone: '0812345678' });
	});

	it('sends the captcha token when it has one', async () => {
		const fetchMock = mockFetch(200, { success: true, items: [] });

		await lookupDonationsByPhone({ phone: '0812345678', captchaToken: 'tok' });

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			phone: '0812345678',
			captcha_token: 'tok'
		});
	});

	it('resolves an empty list for a number with no bookings', async () => {
		mockFetch(200, { success: true, items: [] });
		expect(await lookupDonationsByPhone({ phone: '0899999999' })).toEqual([]);
	});

	it('tells a captcha demand apart from a failed captcha', async () => {
		mockFetch(403, { success: false, error: 'CAPTCHA_REQUIRED' });
		const required = await lookupDonationsByPhone({ phone: '0812345678' }).catch((e) => e);
		expect(required).toBeInstanceOf(DonationLookupCaptchaError);
		expect(required.failed).toBe(false);

		mockFetch(403, { success: false, error: 'CAPTCHA_FAILED' });
		const failed = await lookupDonationsByPhone({ phone: '0812345678' }).catch((e) => e);
		expect(failed).toBeInstanceOf(DonationLookupCaptchaError);
		expect(failed.failed).toBe(true);
	});

	it('maps 429 and 422 to donor-facing copy', async () => {
		mockFetch(429, { success: false, error: 'RATE_LIMITED' });
		await expect(lookupDonationsByPhone({ phone: '0812345678' })).rejects.toThrow('บ่อยเกินไป');

		mockFetch(422, { success: false, error: 'INVALID_PHONE' });
		await expect(lookupDonationsByPhone({ phone: '12' })).rejects.toThrow('เบอร์โทร');
	});
});
