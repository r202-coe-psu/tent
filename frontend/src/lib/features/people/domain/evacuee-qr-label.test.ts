import { describe, expect, it } from 'vitest';
import type { Evacuee } from './people';
import { buildEvacueeQrLabel, EVACUEE_QR_PLACEHOLDER_PAYLOAD } from './evacuee-qr-label';

function ev(partial: {
	status: Evacuee['current_stay']['status'];
	zone?: string | null;
	first_name?: string;
	last_name?: string | null;
}): Evacuee {
	return {
		_id: 'evacuee:abc123',
		type: 'evacuee',
		schema_v: 10,
		first_name: partial.first_name ?? 'สมชาย',
		last_name: partial.last_name ?? 'ใจดี',
		gender: 'other',
		phone: null,
		country: 'TH',
		vulnerable_groups: [],
		special_needs: [],
		household_id: null,
		current_stay: {
			status: partial.status,
			zone: partial.zone ?? null,
			since: '2026-09-03T00:00:00.000Z'
		},
		privacy: { search_excluded: false },
		registered_via: 'web',
		created_at: '2026-09-03T00:00:00.000Z',
		updated_at: '2026-09-03T00:00:00.000Z',
		created_by: 'test',
		shelter_code: 'SH001'
	} as Evacuee;
}

const ZONES = [{ code: 'A', name: 'โซนเอ อาคารเรียน', short_name: 'เอ' }];

describe('buildEvacueeQrLabel', () => {
	it('builds the label for a checked-in evacuee in a zone, with a screening', () => {
		expect(
			buildEvacueeQrLabel(ev({ status: 'active', zone: 'A' }), {
				zones: ZONES,
				hasScreening: true
			})
		).toEqual({
			qrPayload: EVACUEE_QR_PLACEHOLDER_PAYLOAD,
			label: {
				name: 'สมชาย\nใจดี',
				zone: 'เอ',
				emergencyPhone: null,
				checkedCount: 3,
				marker: null
			}
		});
	});

	it('leaves the zone null when none is assigned', () => {
		const { label } = buildEvacueeQrLabel(ev({ status: 'arriving' }), {
			zones: ZONES,
			hasScreening: true
		});
		expect(label.zone).toBeNull();
	});

	it('ticks fewer boxes when the evacuee has no screening', () => {
		const { label } = buildEvacueeQrLabel(ev({ status: 'arriving' }), {
			zones: ZONES,
			hasScreening: false
		});
		expect(label.checkedCount).toBe(1);
	});

	it('uses the issued payload when given, and a non-person placeholder otherwise (CR-233)', () => {
		const e = ev({ status: 'arriving' });
		const issued = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0@683508';
		const input = { hasScreening: false };
		expect(buildEvacueeQrLabel(e, { ...input, qrPayload: issued }).qrPayload).toBe(issued);
		const placeholder = buildEvacueeQrLabel(e, input).qrPayload;
		expect(placeholder).toBe(EVACUEE_QR_PLACEHOLDER_PAYLOAD);
		expect(placeholder.startsWith('evacuee:')).toBe(false);
	});

	it('prints the emergency contact phone as digits only', () => {
		const evacuee = {
			...ev({ status: 'active', zone: 'A' }),
			emergency_contact: { name: 'แม่', phone: '081-234 5678' }
		} as Evacuee;
		const { label } = buildEvacueeQrLabel(evacuee, { zones: ZONES, hasScreening: true });
		expect(label.emergencyPhone).toBe('0812345678');
	});

	it('marks the preview label red when the latest screening is fast_track (#1301)', () => {
		const { label } = buildEvacueeQrLabel(ev({ status: 'active', zone: 'A' }), {
			zones: ZONES,
			hasScreening: true,
			screenings: [
				{ track: 'normal', screened_at: '2026-09-03T01:00:00.000Z' },
				{ track: 'fast_track', screened_at: '2026-09-03T02:00:00.000Z' }
			]
		});
		expect(label.marker).toBe('red');
	});

	it('marks the preview label yellow for vulnerable groups on a normal screening (#1301)', () => {
		const evacuee = { ...ev({ status: 'active' }), vulnerable_groups: ['elderly'] } as Evacuee;
		const { label } = buildEvacueeQrLabel(evacuee, {
			hasScreening: true,
			screenings: [{ track: 'normal', screened_at: '2026-09-03T01:00:00.000Z' }]
		});
		expect(label.marker).toBe('yellow');
	});

	it('leaves the preview marker null with no fast track and no vulnerable groups (#1301)', () => {
		const { label } = buildEvacueeQrLabel(ev({ status: 'active' }), {
			hasScreening: true,
			screenings: [{ track: 'normal', screened_at: '2026-09-03T01:00:00.000Z' }]
		});
		expect(label.marker).toBeNull();
	});

	it('prints the first name alone when there is no last name', () => {
		const { label } = buildEvacueeQrLabel(ev({ status: 'arriving', last_name: '' }), {
			zones: ZONES,
			hasScreening: false
		});
		expect(label.name).toBe('สมชาย');
	});

	it('omits a whitespace-only last name', () => {
		const { label } = buildEvacueeQrLabel(ev({ status: 'arriving', last_name: '   ' }), {
			zones: ZONES,
			hasScreening: false
		});
		expect(label.name).toBe('สมชาย');
	});

	it('gives an empty name when both names are blank', () => {
		const { label } = buildEvacueeQrLabel(
			ev({ status: 'arriving', first_name: ' ', last_name: '' }),
			{ zones: ZONES, hasScreening: false }
		);
		expect(label.name).toBe('');
	});

	it('trims each name part before joining', () => {
		const { label } = buildEvacueeQrLabel(
			ev({ status: 'arriving', first_name: ' สมชาย ', last_name: ' ใจดี ' }),
			{ zones: ZONES, hasScreening: false }
		);
		expect(label.name).toBe('สมชาย\nใจดี');
	});
});
