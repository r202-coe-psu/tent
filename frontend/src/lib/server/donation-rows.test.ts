import { describe, expect, it } from 'vitest';
import type { PublicDonationDoc } from '$lib/features/donations/server';
import { toPendingRow, toReceivedRow } from './donation-rows';

const publicDoc = (over: Record<string, unknown> = {}): PublicDonationDoc =>
	({
		_id: 'donation:01J',
		_rev: '1-a',
		type: 'donation',
		schema_v: 12,
		shelter_code: 'SH001',
		channel: 'public',
		status: 'pending_review',
		donor: { name: 'สมชาย ใจดี', phone: '0812345678', phone_hash: 'h', email: 'sc@example.com' },
		kind: 'items',
		items: [{ item_id: 'item:rice', qty: '10', unit: 'kg', review_status: 'pending' }],
		campaign_id: null,
		booking_ref: 'DN-123456',
		declared_at: '2026-10-01T00:00:00.000Z',
		received_at: null,
		...over
	}) as unknown as PublicDonationDoc;

const m6Doc = (over: Record<string, unknown> = {}): PublicDonationDoc =>
	publicDoc({
		_id: 'donation:m6-WD-0007',
		channel: 'm6',
		status: 'verifying',
		donor: { name: 'คลังกลาง M6 · คลังกลาง A', phone: null, phone_hash: '' },
		booking_ref: 'WD-0007',
		items: [{ free_text: 'น้ำดื่ม', qty: '40', unit: 'ขวด', review_status: 'approved' }],
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

describe('toPendingRow', () => {
	it('passes the channel through and adds no m6 summary to a donor donation', () => {
		const row = toPendingRow(publicDoc());
		expect(row.channel).toBe('public');
		expect(row).not.toHaveProperty('m6');
		expect(row.donor_name).toBe('สมชาย ใจดี');
		expect(row.donor_phone).toBe('0812345678');
	});

	it('summarises an m6 donation without the internal external_ref', () => {
		const row = toPendingRow(m6Doc());
		expect(row.channel).toBe('m6');
		expect(row.m6).toEqual({
			request_code: 'WD-0007',
			source_warehouse_code: 'WH-A',
			source_warehouse_name: 'คลังกลาง A',
			confirmed_at: null,
			confirm_error: null
		});
		expect(JSON.stringify(row)).not.toContain('TENT-SH001');
		expect(row.donor_phone).toBeNull();
		expect(row.booking_ref).toBe('WD-0007');
	});

	it('does not break on an m6 doc with no logistics, expires_at or tracking token', () => {
		const row = toPendingRow(m6Doc());
		expect(row.delivery_method).toBeUndefined();
		expect(row.slot).toBeUndefined();
		expect(row.vehicle).toBeNull();
		expect(row.pickup_address).toBeNull();
	});

	it('never flags an m6 delivery as an unsolicited donation, even for a free-text line', () => {
		expect(toPendingRow(m6Doc()).is_unsolicited).toBe(false);
		expect(
			toPendingRow(publicDoc({ items: [{ free_text: 'อื่นๆ', qty: '1', unit: 'ชิ้น' }] }))
				.is_unsolicited
		).toBe(true);
	});

	it('survives an m6 doc whose external is missing', () => {
		const row = toPendingRow(m6Doc({ external: undefined }));
		expect(row.channel).toBe('m6');
		expect(row).not.toHaveProperty('m6');
	});
});

describe('toReceivedRow', () => {
	it('still masks the donor contact of a donor donation', () => {
		const row = toReceivedRow(publicDoc({ status: 'received' }));
		expect(row.donor_name).not.toBe('สมชาย ใจดี');
		expect(row.donor_phone).toBe('xxx-xxx-5678');
		expect(row.contact_masked).toBe(true);
	});

	it('shows the source warehouse of an m6 donation unmasked, with its confirmation state', () => {
		const row = toReceivedRow(
			m6Doc({
				status: 'received',
				external: {
					system: 'm6',
					request_code: 'WD-0007',
					external_ref: 'x',
					source_warehouse_code: 'WH-A',
					source_warehouse_name: 'คลังกลาง A',
					confirmed_at: null,
					confirm_error: 'timeout'
				}
			})
		);
		expect(row.donor_name).toBe('คลังกลาง M6 · คลังกลาง A');
		expect(row.donor_phone).toBeNull();
		expect(row.contact_masked).toBeUndefined();
		expect(row.channel).toBe('m6');
		expect(row.m6?.confirm_error).toBe('timeout');
	});

	it('carries what was received on an m6 donation', () => {
		const row = toReceivedRow(
			m6Doc({
				status: 'received',
				received_summary: {
					total_items: 1,
					received_at: '2026-10-02T00:00:00.000Z',
					items: [{ free_text: 'น้ำดื่ม', qty: '38', unit: 'ขวด' }]
				}
			})
		);
		expect(row.received_items).toEqual([
			{ item_id: undefined, free_text: 'น้ำดื่ม', qty: '38', unit: 'ขวด' }
		]);
	});
});
