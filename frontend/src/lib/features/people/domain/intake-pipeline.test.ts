import { describe, expect, it } from 'vitest';
import type { Evacuee } from './people';
import {
	buildZoningPath,
	classifyZoningQueueTab,
	countOccupantsByZone,
	nextQueueLabel,
	parseZoningQrCode,
	recommendZoneKind
} from './intake-pipeline';

function ev(partial: {
	status: Evacuee['current_stay']['status'];
	zone?: string | null;
	special_needs?: string[];
	id?: string;
}): Evacuee {
	return {
		_id: partial.id ?? 'evacuee:1',
		type: 'evacuee',
		schema_v: 9,
		first_name: 'ก',
		last_name: 'ข',
		gender: 'other',
		phone: null,
		country: 'TH',
		special_needs: partial.special_needs ?? [],
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

describe('nextQueueLabel', () => {
	it('returns รอแพทย์ when flag on, arriving, no screening', () => {
		expect(
			nextQueueLabel(ev({ status: 'arriving' }), {
				enableMedicalScreening: true,
				hasScreening: false
			})
		).toBe('รอแพทย์');
	});

	it('returns รอโซน when flag on, arriving, has screening', () => {
		expect(
			nextQueueLabel(ev({ status: 'arriving' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('รอโซน');
	});

	it('returns รอโซน when flag off and arriving', () => {
		expect(
			nextQueueLabel(ev({ status: 'arriving' }), {
				enableMedicalScreening: false,
				hasScreening: false
			})
		).toBe('รอโซน');
	});

	it('returns พักแล้ว for active or zoned', () => {
		expect(
			nextQueueLabel(ev({ status: 'active', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('พักแล้ว');
	});
});

describe('classifyZoningQueueTab', () => {
	it('pending when flag off and arriving without zone', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'arriving' }), {
				enableMedicalScreening: false,
				hasScreening: false
			})
		).toBe('pending');
	});

	it('hides arriving without screening when flag on', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'arriving' }), {
				enableMedicalScreening: true,
				hasScreening: false
			})
		).toBeNull();
	});

	it('pending when flag on, arriving, screened, no zone', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'arriving' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('pending');
	});

	it('assigned when active with zone', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'active', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('assigned');
	});
});

describe('recommendZoneKind', () => {
	it('prefers quarantine for red/yellow triage', () => {
		expect(recommendZoneKind({ special_needs: ['wheelchair'] }, 'red')).toBe('quarantine');
		expect(recommendZoneKind({ special_needs: [] }, 'yellow')).toBe('quarantine');
	});

	it('uses vulnerable for special_needs when triage green/null', () => {
		expect(recommendZoneKind({ special_needs: ['infant'] }, 'green')).toBe('vulnerable');
		expect(recommendZoneKind({ special_needs: ['infant'] }, null)).toBe('vulnerable');
	});

	it('defaults to general', () => {
		expect(recommendZoneKind({ special_needs: [] }, null)).toBe('general');
	});
});

describe('parseZoningQrCode', () => {
	it('parses zoning and medical paths and bare ids', () => {
		expect(parseZoningQrCode('/onsite/zoning/evacuee:ABC')).toBe('evacuee:ABC');
		expect(parseZoningQrCode('/onsite/medical-screening/evacuee:XYZ')).toBe('evacuee:XYZ');
		expect(parseZoningQrCode('evacuee:BARE')).toBe('evacuee:BARE');
	});

	it('rejects bare station roots', () => {
		expect(parseZoningQrCode('/onsite/zoning')).toBeNull();
		expect(parseZoningQrCode('/onsite/medical-screening')).toBeNull();
	});
});

describe('countOccupantsByZone', () => {
	it('counts active/temporary_leave only', () => {
		const counts = countOccupantsByZone([
			ev({ status: 'active', zone: 'A', id: '1' }),
			ev({ status: 'active', zone: 'A', id: '2' }),
			ev({ status: 'temporary_leave', zone: 'A', id: '3' }),
			ev({ status: 'arriving', zone: null, id: '4' }),
			ev({ status: 'checked_out', zone: 'A', id: '5' })
		]);
		expect(counts.get('A')).toBe(3);
	});
});

describe('buildZoningPath', () => {
	it('builds path-only deep link', () => {
		expect(buildZoningPath('evacuee:1')).toBe('/onsite/zoning/evacuee:1');
	});
});
