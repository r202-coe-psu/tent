import { describe, expect, it } from 'vitest';
import type { Evacuee } from './people';
import { buildEvacueeQrLabel } from './evacuee-qr-label';

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
			qrPayload: 'evacuee:abc123',
			label: {
				name: 'สมชาย\nใจดี',
				zone: 'เอ',
				emergencyPhone: null,
				checkedCount: 3
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

	it('prints the emergency contact phone as digits only', () => {
		const evacuee = {
			...ev({ status: 'active', zone: 'A' }),
			emergency_contact: { name: 'แม่', phone: '081-234 5678' }
		} as Evacuee;
		const { label } = buildEvacueeQrLabel(evacuee, { zones: ZONES, hasScreening: true });
		expect(label.emergencyPhone).toBe('0812345678');
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
