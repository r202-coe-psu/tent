import { describe, expect, it } from 'vitest';
import {
	buildBoxLabels,
	canPrintBoxLabel,
	clipLabelLines,
	type BoxLabelLine,
	type BoxLabelSource,
	type BoxLabelSourceItem
} from './box-label';
import { resolveDropOffPoint, type DropOffPoint } from './drop-off';
import { toDonationTrackView } from './tracking';

const SHELTER = {
	code: 'SH001',
	name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
	address: '99 ถ.เพชรเกษม',
	geo: { lat: 7.0086, lng: 100.4747 }
};

function mainPoint(): DropOffPoint {
	return resolveDropOffPoint(SHELTER);
}

function source(
	overrides: Partial<BoxLabelSource> = {},
	items?: BoxLabelSourceItem[]
): BoxLabelSource {
	const view = toDonationTrackView({
		status: 'verifying',
		booking_ref: 'DN-591001',
		shelter_code: 'SH001',
		donor: {
			name: 'สมชาย ใจดี',
			phone_masked: '***-***-5678',
			email: 'somchai@example.com',
			line_id: 'somchai'
		},
		items: [
			{ item_id: 'i1', item_name: 'ข้าวสาร', qty: 5, unit: 'kg' },
			{ item_id: 'i2', item_name: 'น้ำดื่ม', qty: '12', unit: 'bottle' }
		],
		logistics: {
			delivery_method: 'self_dropoff',
			slot: { date: '2026-10-27', from: '09:00', to: '11:00' },
			pickup_address: '12 ซอยลับ บ้านผู้บริจาค'
		},
		received_summary: null,
		reject_reason: null,
		updated_at: '2026-10-26T03:00:00Z',
		expires_at: null
	});
	return { ...view, items: items ?? view.items, ...overrides };
}

describe('canPrintBoxLabel', () => {
	it('opens only once the shelter expects the goods', () => {
		expect(canPrintBoxLabel('verifying')).toBe(true);
		for (const status of [
			'declared',
			'pending_review',
			'received',
			'rejected',
			'cancelled',
			'expired',
			'redirected'
		]) {
			expect(canPrintBoxLabel(status)).toBe(false);
		}
	});
});

describe('buildBoxLabels', () => {
	it('builds one label for an ordinary booking, with every line and the schedule', () => {
		const labels = buildBoxLabels(source(), mainPoint);

		expect(labels).toHaveLength(1);
		expect(labels[0]).toMatchObject({
			bookingRef: 'DN-591001',
			deliveryMethod: 'self_dropoff',
			schedule: '2026-10-27 (09:00 - 11:00)',
			sheet: { index: 1, total: 1 },
			destination: { name: SHELTER.name, address: SHELTER.address }
		});
		expect(labels[0]!.lines).toEqual([
			{ name: 'ข้าวสาร', qty: 5, unit: 'kg' },
			{ name: 'น้ำดื่ม', qty: '12', unit: 'bottle' }
		]);
	});

	it('encodes the booking ref in the QR and never the tracking token', () => {
		// A caller may hold the token next to the booking; none of it may leak into the label.
		const withToken = { ...source(), trackingToken: 'TX-SH001-SECRET' };
		const [label] = buildBoxLabels(withToken, mainPoint);

		expect(label!.qrValue).toBe(label!.bookingRef);
		expect(JSON.stringify(label)).not.toContain('TX-SH001-SECRET');
	});

	it('carries nothing about the donor', () => {
		const [label] = buildBoxLabels(source(), mainPoint);
		const printed = JSON.stringify(label);

		for (const secret of ['สมชาย', '5678', 'somchai', 'ซอยลับ', 'pickup_address']) {
			expect(printed).not.toContain(secret);
		}
	});

	it('leaves out lines the shelter turned away', () => {
		const view = source();
		view.items[0] = { ...view.items[0]!, review_status: 'rejected', review_reason: 'หมดอายุ' };
		view.received_summary = {
			items: [{}, { rejected: true, reject_reason: 'ของไม่ตรง' }]
		};

		expect(buildBoxLabels(view, mainPoint)).toEqual([]);

		view.received_summary = null;
		const [label] = buildBoxLabels(view, mainPoint);
		expect(label!.lines.map((line) => line.name)).toEqual(['น้ำดื่ม']);
	});

	it('prints nothing before the shelter accepted the booking', () => {
		for (const status of ['declared', 'pending_review', 'received', 'cancelled']) {
			expect(buildBoxLabels(source({ status }), mainPoint)).toEqual([]);
		}
	});

	it('prints nothing without a booking ref to scan', () => {
		expect(buildBoxLabels(source({ booking_ref: null }), mainPoint)).toEqual([]);
	});

	it('has no schedule when the booking has no slot or ETA', () => {
		const [label] = buildBoxLabels(source({ logistics: { delivery_method: 'parcel' } }), mainPoint);

		expect(label!.schedule).toBeNull();
	});

	it('makes one label per drop-off point, in the order the goods were listed', () => {
		const pointNamed = (pointId: string | null): DropOffPoint => ({
			...mainPoint(),
			pointId,
			name: pointId ?? 'main'
		});
		const items: BoxLabelSourceItem[] = [
			{
				item_id: 'a',
				item_name: 'ข้าวสาร',
				qty: 1,
				unit: 'kg',
				drop_off_point_id: 'gate-2',
				line_key: null
			},
			{
				item_id: 'b',
				item_name: 'ยา',
				qty: 2,
				unit: 'box',
				drop_off_point_id: null,
				line_key: null
			},
			{
				item_id: 'c',
				item_name: 'น้ำ',
				qty: 3,
				unit: 'bottle',
				drop_off_point_id: 'gate-2',
				line_key: null
			}
		];

		const labels = buildBoxLabels(source({}, items), pointNamed);

		expect(labels.map((l) => l.destination.name)).toEqual(['gate-2', 'main']);
		expect(labels.map((l) => l.lines.map((line) => line.name))).toEqual([
			['ข้าวสาร', 'น้ำ'],
			['ยา']
		]);
		expect(labels.map((l) => l.sheet)).toEqual([
			{ index: 1, total: 2 },
			{ index: 2, total: 2 }
		]);
	});
});

describe('clipLabelLines', () => {
	const lines = (n: number): BoxLabelLine[] =>
		Array.from({ length: n }, (_, i) => ({ name: `item ${i + 1}`, qty: 1, unit: 'kg' }));

	it('shows every line that fits', () => {
		expect(clipLabelLines(lines(8), 8)).toEqual({ shown: lines(8), hidden: 0 });
	});

	it('keeps a row for the "and k more" note when the goods overflow', () => {
		const { shown, hidden } = clipLabelLines(lines(12), 8);

		expect(shown).toHaveLength(7);
		expect(hidden).toBe(5);
	});
});
