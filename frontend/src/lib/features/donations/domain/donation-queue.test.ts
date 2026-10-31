import { describe, expect, it } from 'vitest';
import type { PendingDonationRow } from './back-office';
import {
	buildReceivedFindBody,
	DONATION_QUEUE_FILTERS,
	DONATION_QUEUE_STATUSES,
	DONATION_STATUS_ALLOWLIST,
	filterDonationQueue,
	isAllowedDonationStatus,
	filterForLegacyTab,
	mergeQueueResponses,
	parseQueueFilter,
	queueGroupOf
} from './donation-queue';

const row = (over: Partial<PendingDonationRow>): PendingDonationRow => ({
	shelter_code: 'SH001',
	status: 'pending_review',
	donor_name: 'ผู้บริจาค',
	donor_phone: null,
	item_count: 1,
	items: [],
	point_receipts: [],
	...over
});

describe('booking list filters (#617)', () => {
	const rows = [
		row({ booking_ref: 'DN-1', status: 'pending_review' }),
		row({ booking_ref: 'DN-2', status: 'verifying' }),
		row({ booking_ref: 'DN-3', status: 'declared' })
	];

	it('groups review apart from drop-off', () => {
		expect(queueGroupOf('pending_review')).toBe('pending');
		expect(queueGroupOf('verifying')).toBe('awaiting');
		expect(queueGroupOf('declared')).toBe('awaiting');
	});

	it('narrows to one group, or shows both', () => {
		expect(filterDonationQueue(rows, 'pending').map((r) => r.booking_ref)).toEqual(['DN-1']);
		expect(filterDonationQueue(rows, 'awaiting').map((r) => r.booking_ref)).toEqual([
			'DN-2',
			'DN-3'
		]);
		expect(filterDonationQueue(rows, 'all')).toHaveLength(3);
	});

	it('reads an unknown filter as "all"', () => {
		expect(parseQueueFilter('awaiting')).toBe('awaiting');
		expect(parseQueueFilter('bogus')).toBe('all');
		expect(parseQueueFilter(null)).toBe('all');
	});

	it('sends the old tab links to the filter that matches them', () => {
		expect(filterForLegacyTab('scan')).toBe('awaiting');
		expect(filterForLegacyTab('pending')).toBe('pending');
		expect(filterForLegacyTab('needs')).toBeNull();
	});
});

describe('mergeQueueResponses', () => {
	it('keeps one row per booking and keeps walk-ins addressed by doc id', () => {
		const merged = mergeQueueResponses([
			[row({ booking_ref: 'DN-1' })],
			[row({ booking_ref: 'DN-1', status: 'verifying' }), row({ donation_id: 'donation:w1' })],
			[row({})]
		]);
		expect(merged.map((r) => r.booking_ref ?? r.donation_id)).toEqual(['DN-1', 'donation:w1']);
	});
});

describe('received filter (#821)', () => {
	const rows = [
		row({ booking_ref: 'DN-1', status: 'pending_review' }),
		row({ booking_ref: 'DN-2', status: 'declared' }),
		row({ booking_ref: 'DN-3', status: 'received' })
	];

	it('E1: adds "รับแล้ว" after the existing filters, leaving them as they were', () => {
		expect(DONATION_QUEUE_FILTERS.map((f) => f.value)).toEqual([
			'all',
			'pending',
			'awaiting',
			'received'
		]);
		expect(DONATION_QUEUE_FILTERS.at(-1)?.label).toBe('รับแล้ว');
		expect(parseQueueFilter('received')).toBe('received');
		expect(parseQueueFilter('bogus')).toBe('all');
	});

	it('E1c: the open queue statuses never include received', () => {
		expect([...DONATION_QUEUE_STATUSES]).toEqual(['pending_review', 'verifying', 'declared']);
	});

	it('E8: "ทั้งหมด", pending and awaiting never contain a received row', () => {
		for (const f of ['all', 'pending', 'awaiting'] as const) {
			expect(filterDonationQueue(rows, f).map((r) => r.status)).not.toContain('received');
		}
		expect(filterDonationQueue(rows, 'all')).toHaveLength(2);
		expect(queueGroupOf('received')).toBe('received');
		expect(filterDonationQueue(rows, 'received').map((r) => r.booking_ref)).toEqual(['DN-3']);
	});

	it('E9: the status allowlist is the open statuses plus received', () => {
		expect([...DONATION_STATUS_ALLOWLIST]).toEqual([
			'pending_review',
			'verifying',
			'declared',
			'received'
		]);
		expect(isAllowedDonationStatus('received')).toBe(true);
		for (const bad of ['rejected', 'cancelled', '', 'RECEIVED', 'declared,received']) {
			expect(isAllowedDonationStatus(bad)).toBe(false);
		}
	});

	it('E6: the _find body is bounded, index-pinned, bookmark-paged and has no skip', () => {
		const first = buildReceivedFindBody();
		expect(first).toEqual({
			selector: { type: 'donation', status: 'received' },
			sort: [{ type: 'desc' }, { status: 'desc' }, { received_at: 'desc' }, { _id: 'desc' }],
			use_index: ['_design/donation-received-list', 'donation-received-by-received-at'],
			allow_fallback: false,
			limit: 20
		});
		expect(buildReceivedFindBody('bm')).toMatchObject({ bookmark: 'bm' });
		expect(buildReceivedFindBody(null)).not.toHaveProperty('bookmark');
		expect(first).not.toHaveProperty('skip');
	});
});
