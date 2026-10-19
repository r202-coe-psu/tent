import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cancelDonation,
	DonationLookupCaptchaError,
	lookupDonationsByPhone,
	updateCourierTracking,
	updateDonationItems,
	type DonationItemEdit
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

	it('asks the donor to retry when the shelter record cannot be read', async () => {
		mockFetch(503, { success: false, error: 'DONATION_UNAVAILABLE' });

		await expect(cancelDonation('tok')).rejects.toThrow('กรุณาลองใหม่อีกครั้ง');
	});
});

describe('updateCourierTracking', () => {
	it('asks the donor to retry when the shelter record cannot be read', async () => {
		mockFetch(503, { success: false, error: 'DONATION_UNAVAILABLE' });

		await expect(updateCourierTracking('tok', 'TH1')).rejects.toThrow('กรุณาลองใหม่อีกครั้ง');
	});
});

describe('updateDonationItems', () => {
	const items: DonationItemEdit[] = [{ free_text: 'ผ้าห่ม', qty: '1', unit: 'piece' }];

	// CR-174 — keeping only lines the shelter refused is refused; the booking itself is
	// still the donor's, so the copy points at cancelling rather than "locked".
	it('tells the donor to cancel when the edit would keep only refused lines', async () => {
		mockFetch(400, {
			success: false,
			error: 'NO_ACCEPTED_ITEMS',
			message: 'ต้องเหลืออย่างน้อย 1 รายการ'
		});

		await expect(updateDonationItems('tok', items)).rejects.toThrow('ยกเลิกการจองนี้');
	});

	it('still reads any other 400 as a booking staff have taken over', async () => {
		mockFetch(400, { success: false, error: 'Cannot edit a donation in status "received"' });

		await expect(updateDonationItems('tok', items)).rejects.toThrow('แก้ไม่ได้แล้ว');
	});

	it('asks the donor to retry when the shelter record cannot be read', async () => {
		mockFetch(503, { success: false, error: 'DONATION_UNAVAILABLE' });

		await expect(updateDonationItems('tok', items)).rejects.toThrow('กรุณาลองใหม่อีกครั้ง');
	});

	it('asks the donor to reload when the shelter changed the booking mid-edit', async () => {
		mockFetch(409, { success: false, error: 'BOOKING_CHANGED', message: 'reload' });

		await expect(updateDonationItems('tok', items)).rejects.toThrow('รีเฟรช');
	});
});

// Owner decision 2026-10-22 — once goods are in stock the donor can no longer change the
// booking; the copy says so instead of "try again".
describe('goods already in stock', () => {
	it('tells the donor why a cancel is refused', async () => {
		mockFetch(409, { success: false, error: 'GOODS_IN_STOCK' });

		await expect(cancelDonation('tok')).rejects.toThrow('ศูนย์เริ่มรับของของใบนี้เข้าคลังแล้ว');
	});

	it('tells the donor why an edit is refused', async () => {
		mockFetch(409, { success: false, error: 'GOODS_IN_STOCK' });

		await expect(
			updateDonationItems('tok', [{ free_text: 'ผ้าห่ม', qty: '1', unit: 'piece' }])
		).rejects.toThrow('ศูนย์เริ่มรับของของใบนี้เข้าคลังแล้ว');
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
