import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchDonationDetail,
	fetchDonationsByStatus,
	receiveDonationCount
} from './back-office-donations';

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

describe('fetchDonationsByStatus', () => {
	it('asks the BFF for one lifecycle status', async () => {
		const fetchMock = mockFetch(200, { success: true, donations: [] });

		await fetchDonationsByStatus('verifying');

		expect(fetchMock).toHaveBeenCalledWith('/api/back-office/donations?status=verifying');
	});

	it('returns the rows the route redacted', async () => {
		mockFetch(200, {
			success: true,
			donations: [{ booking_ref: 'DN-000001', shelter_code: 'SH001', item_count: 2 }]
		});

		const rows = await fetchDonationsByStatus('verifying');

		expect(rows).toHaveLength(1);
		expect(rows[0].booking_ref).toBe('DN-000001');
	});

	it('treats a body with no donations array as an empty queue', async () => {
		mockFetch(200, { success: true });
		await expect(fetchDonationsByStatus('verifying')).resolves.toEqual([]);
	});

	it('names the capability a 403 is really about', async () => {
		// The route gates on warehouse_staff / shelter_manager / SA, so "forbidden" alone
		// sends staff hunting for a bug that is actually a missing role.
		mockFetch(403, { success: false, error: 'Requires warehouse_staff' });

		await expect(fetchDonationsByStatus('verifying')).rejects.toThrow(/เจ้าหน้าที่คลัง/);
	});
});

describe('fetchDonationDetail', () => {
	it('encodes the booking ref into the path', async () => {
		const fetchMock = mockFetch(200, { success: true, donation: { shelter_code: 'SH001' } });

		await fetchDonationDetail('DN/001 x');

		expect(fetchMock).toHaveBeenCalledWith('/api/back-office/donations/DN%2F001%20x');
	});

	it('maps 404 to donor-desk copy', async () => {
		mockFetch(404, { success: false, error: 'Donation not found' });
		await expect(fetchDonationDetail('DN-404')).rejects.toThrow('ไม่พบข้อมูลการจองบริจาคนี้');
	});

	it('rejects a 200 that carries no donation rather than returning undefined', async () => {
		mockFetch(200, { success: true });
		await expect(fetchDonationDetail('DN-000001')).rejects.toThrow('ไม่พบข้อมูลการจองบริจาคนี้');
	});
});

describe('receiveDonationCount', () => {
	it('posts the counted lines with status locked to received', async () => {
		const fetchMock = mockFetch(200, { success: true });

		await receiveDonationCount({
			query: 'DN-000001',
			items: [
				{
					item_id: 'item:rice',
					qty: '8',
					unit: 'kg',
					lot: { expiry: '2026-12-31', note: 'L-260825-001 · Zone A' }
				}
			],
			remarks: '  ของมาไม่ครบ  '
		});

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/back-office/donations/DN-000001');
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body);
		expect(body.status).toBe('received');
		// Trimmed — a remark of pure whitespace would otherwise land in received_summary.
		expect(body.remarks).toBe('ของมาไม่ครบ');
		expect(body.items[0].lot.note).toBe('L-260825-001 · Zone A');
	});

	it('omits remarks entirely when staff typed only whitespace', async () => {
		const fetchMock = mockFetch(200, { success: true });

		await receiveDonationCount({ query: 'DN-000001', items: [], remarks: '   ' });

		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('remarks');
	});

	it('surfaces the catalog invariant the route enforces', async () => {
		// Perishable items must carry lot.expiry (schema.md §2.1) — the route checks it
		// because it writes with admin credentials, so validate_doc_update never runs.
		mockFetch(422, {
			success: false,
			error: 'Perishable item item:egg requires lot.expiry to be set'
		});

		await expect(receiveDonationCount({ query: 'DN-000001', items: [] })).rejects.toThrow(
			/lot.expiry/
		);
	});

	it('fails on a 200 whose body did not confirm success', async () => {
		// The route answers { success: false } with a 200 on some guarded paths; treating
		// that as done would clear the booking off the tab with no ledger behind it.
		mockFetch(200, { success: false, error: 'Donation is already received (LOCKED)' });

		await expect(receiveDonationCount({ query: 'DN-000001', items: [] })).rejects.toThrow(/LOCKED/);
	});
});
