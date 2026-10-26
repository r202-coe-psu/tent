import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cancelDonation,
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

	// CR-196 FR-LK-4 — reviewed since the page loaded: the same words as the disabled button.
	it('points the donor at cancelling once the booking was reviewed', async () => {
		mockFetch(400, { success: false, error: 'ALREADY_REVIEWED' });

		await expect(updateDonationItems('tok', items)).rejects.toThrow('กรุณายกเลิกเพื่อทำรายการใหม่');
	});

	it.each(['UNKNOWN_LINE_KEY', 'DUPLICATE_LINE_KEY'])(
		'asks the donor to reload when the form names lines the booking no longer holds (%s)',
		async (error) => {
			mockFetch(400, { success: false, error, line_key: '01K8X' });

			await expect(updateDonationItems('tok', items)).rejects.toThrow('รีเฟรช');
		}
	);

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
