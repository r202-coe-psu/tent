import { describe, expect, it } from 'vitest';
import type { PublicDonationDoc } from '$lib/features/donations/server';
import { toScanView } from './donation-scan-view';

const doc = (over: Record<string, unknown> = {}): PublicDonationDoc =>
	({
		_id: 'donation:01J',
		_rev: '2-b',
		type: 'donation',
		schema_v: 12,
		shelter_code: 'SH001',
		channel: 'public',
		status: 'verifying',
		donor: { name: 'สมชาย ใจดี', phone: '0812345678', phone_hash: 'h', email: 'sc@example.com' },
		kind: 'items',
		items: [{ item_id: 'item:rice', qty: '10', unit: 'kg', review_status: 'approved' }],
		campaign_id: null,
		booking_ref: 'DN-123456',
		declared_at: '2026-10-01T00:00:00.000Z',
		received_at: null,
		...over
	}) as unknown as PublicDonationDoc;

const m6 = (over: Record<string, unknown> = {}) =>
	doc({
		channel: 'm6',
		donor: { name: 'คลังกลาง M6 · คลังกลาง A', phone: null, phone_hash: '' },
		booking_ref: 'WD-0007',
		external: {
			system: 'm6',
			request_code: 'WD-0007',
			external_ref: 'TENT-SH001-01J',
			source_warehouse_code: 'WH-A',
			source_warehouse_name: 'คลังกลาง A',
			confirmed_at: null,
			confirm_error: null
		},
		...over
	});

describe('toScanView', () => {
	it('passes the channel through and keeps a donor donation as it was', () => {
		const view = toScanView(doc());
		expect(view.channel).toBe('public');
		expect(view).not.toHaveProperty('m6');
		expect(view.donor).toEqual({
			name: 'สมชาย ใจดี',
			phone: '0812345678',
			email: 'sc@example.com'
		});
	});

	it('masks the contact of a received donor donation', () => {
		const view = toScanView(doc({ status: 'received' }));
		expect(view.donor.phone).toBe('xxx-xxx-5678');
	});

	it('gives an m6 donation its source summary and no secrets', () => {
		const view = toScanView(m6());
		expect(view.channel).toBe('m6');
		expect(view.m6).toEqual({
			request_code: 'WD-0007',
			source_warehouse_code: 'WH-A',
			source_warehouse_name: 'คลังกลาง A',
			confirmed_at: null,
			confirm_error: null
		});
		expect(view.donor.phone).toBeNull();
		const json = JSON.stringify(view);
		expect(json).not.toContain('TENT-SH001');
		expect(json).not.toContain('phone_hash');
	});

	it('does not mask the source warehouse of a received m6 donation', () => {
		const view = toScanView(m6({ status: 'received' }));
		expect(view.donor.name).toBe('คลังกลาง M6 · คลังกลาง A');
	});

	it('handles an m6 doc with no logistics', () => {
		const view = toScanView(m6());
		expect(view.logistics).toBeUndefined();
		expect(view.items).toHaveLength(1);
	});
});
