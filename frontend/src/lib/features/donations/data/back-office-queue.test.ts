import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchDonationQueue,
	fetchDonorContact,
	fetchReceivedDonationsPage,
	searchReceivedDonations
} from './back-office-queue';

const respond = (body: unknown, ok = true, status = ok ? 200 : 400) =>
	Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);

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

describe('searchReceivedDonations (#821 FR-8)', () => {
	const call = (fetchMock: ReturnType<typeof vi.fn>) => {
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		return { url, init, body: JSON.parse(String(init.body)) };
	};

	it('POSTs the term in the body, never in the URL', async () => {
		const fetchMock = vi.fn(() =>
			respond({ success: true, donations: [{ donor_name: 'ก' }], cursor: 'c2', has_more: true })
		);
		vi.stubGlobal('fetch', fetchMock);

		const page = await searchReceivedDonations({
			shelterCode: 'SH001',
			by: 'phone',
			q: '081-234-5678',
			cursor: 'c1'
		});

		const { url, init, body } = call(fetchMock);
		expect(url).toBe('/api/back-office/donations/received/search');
		expect(init.method).toBe('POST');
		expect(body).toEqual({ shelter_code: 'SH001', by: 'phone', q: '081-234-5678', cursor: 'c1' });
		expect(url).not.toContain('5678');
		expect(page).toEqual({ donations: [{ donor_name: 'ก' }], cursor: 'c2', hasMore: true });
	});

	it('leaves out an empty shelter code and a missing cursor, and ends with no cursor', async () => {
		const fetchMock = vi.fn(() =>
			respond({ success: true, donations: [], cursor: 'ignored', has_more: false })
		);
		vi.stubGlobal('fetch', fetchMock);

		const page = await searchReceivedDonations({ shelterCode: '', by: 'name', q: 'สมชาย' });

		expect(call(fetchMock).body).toEqual({ by: 'name', q: 'สมชาย' });
		expect(page).toEqual({ donations: [], cursor: null, hasMore: false });
	});

	it.each([
		[
			'INVALID_PHONE',
			400,
			{ error_code: 'INVALID_PHONE' },
			'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0'
		],
		['INVALID_LOT', 400, { error_code: 'INVALID_LOT' }, 'เลขล็อตต้องเป็นรูปแบบ L-YYMMDD-XXX'],
		[
			'503 index unavailable',
			503,
			{ error: 'DONATION_INDEX_UNAVAILABLE' },
			'ยังไม่พร้อมแสดงรายการที่รับแล้ว (ฐานข้อมูลของศูนย์ยังไม่มีดัชนี) กรุณาติดต่อผู้ดูแลระบบ'
		]
	])('says the right thing for %s', async (_label, status, body, message) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => respond({ success: false, ...body }, false, status))
		);

		await expect(
			searchReceivedDonations({ shelterCode: 'SH001', by: 'phone', q: '5678' })
		).rejects.toThrow(message);
	});
});

describe('fetchDonorContact (#821 FR-10a)', () => {
	it('POSTs to the donation contact route and returns the three fields', async () => {
		const fetchMock = vi.fn(() =>
			respond({
				success: true,
				contact: { name: 'สมชาย ใจดี', phone: '0812345678', email: 'somchai@example.com' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const contact = await fetchDonorContact('donation:w001');

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/back-office/donations/donation%3Aw001/contact');
		expect(init.method).toBe('POST');
		expect(contact).toEqual({
			name: 'สมชาย ใจดี',
			phone: '0812345678',
			email: 'somchai@example.com'
		});
	});

	it('returns nulls when the contact was removed (FR-10c)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => respond({ success: true, contact: { name: null, phone: null, email: null } }))
		);

		expect(await fetchDonorContact('DN-1')).toEqual({ name: null, phone: null, email: null });
	});

	it('throws when the server refuses, and when the access could not be audited (503)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => respond({ success: false, error: 'Forbidden' }, false, 403))
		);
		await expect(fetchDonorContact('DN-1')).rejects.toThrow('ไม่มีสิทธิ์');

		vi.stubGlobal(
			'fetch',
			vi.fn(() => respond({ success: false }, false, 503))
		);
		await expect(fetchDonorContact('DN-1')).rejects.toThrow('ยังบันทึกการเปิดดูข้อมูลไม่ได้');
	});
});
