import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDonationQueue, fetchReceivedDonationsPage } from './back-office-queue';

const respond = (body: unknown, ok = true) =>
	Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

afterEach(() => vi.unstubAllGlobals());

describe('fetchDonationQueue', () => {
	it('E2: asks for the three open statuses and never for received', async () => {
		const fetchMock = vi.fn(() => respond({ success: true, donations: [] }));
		vi.stubGlobal('fetch', fetchMock);

		await fetchDonationQueue();

		const urls = (fetchMock.mock.calls as unknown as string[][]).map((c) => c[0]);
		expect(urls.sort()).toEqual([
			'/api/back-office/donations?status=declared',
			'/api/back-office/donations?status=pending_review',
			'/api/back-office/donations?status=verifying'
		]);
	});
});

describe('fetchReceivedDonationsPage', () => {
	it('E2b: sends status, shelter and bookmark, and returns the next cursor', async () => {
		const fetchMock = vi.fn(() =>
			respond({ success: true, donations: [{ donor_name: 'ก' }], bookmark: 'b2', has_more: true })
		);
		vi.stubGlobal('fetch', fetchMock);

		const page = await fetchReceivedDonationsPage('SH001', 'b1');

		const url = new URL((fetchMock.mock.calls as unknown as string[][])[0][0], 'http://x');
		expect(url.searchParams.get('status')).toBe('received');
		expect(url.searchParams.get('shelter')).toBe('SH001');
		expect(url.searchParams.get('bookmark')).toBe('b1');
		expect(page).toMatchObject({ bookmark: 'b2', hasMore: true });
	});

	it('first page sends no bookmark; the end of data drops the cursor', async () => {
		const fetchMock = vi.fn(() =>
			respond({ success: true, donations: [], bookmark: 'stale', has_more: false })
		);
		vi.stubGlobal('fetch', fetchMock);

		const page = await fetchReceivedDonationsPage('SH001');

		expect((fetchMock.mock.calls as unknown as string[][])[0][0]).not.toContain('bookmark');
		expect(page).toEqual({ donations: [], bookmark: null, hasMore: false });
	});

	it('E6g: names the missing index instead of showing an empty list; other errors throw too', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => respond({ success: false, error: 'DONATION_INDEX_UNAVAILABLE' }, false))
		);
		await expect(fetchReceivedDonationsPage('SH001')).rejects.toThrow(/ดัชนี/);

		vi.stubGlobal(
			'fetch',
			vi.fn(() => respond({ success: false, error: 'Forbidden' }, false))
		);
		await expect(fetchReceivedDonationsPage('SH001')).rejects.toThrow('Forbidden');
	});
});
