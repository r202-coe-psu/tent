import { describe, expect, it } from 'vitest';
import type { PendingDonationRow } from './back-office';
import {
	filterDonationQueue,
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
