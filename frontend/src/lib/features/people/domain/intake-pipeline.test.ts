import { describe, expect, it } from 'vitest';
import type { Evacuee } from './people';
import {
	buildZoningPath,
	classifyScreeningQueueTab,
	classifyZoningQueueTab,
	countPresentOccupantsByZone,
	formatQueueWait,
	isInShelterStatus,
	nextQueueLabel,
	parseZoningQrCode,
	recommendZoneKind,
	sortByZoningQueueSince,
	zoningQueueSince
} from './intake-pipeline';

function ev(partial: {
	status: Evacuee['current_stay']['status'];
	zone?: string | null;
	special_needs?: string[];
	vulnerable_groups?: string[];
	id?: string;
}): Evacuee {
	return {
		_id: partial.id ?? 'evacuee:1',
		type: 'evacuee',
		schema_v: 10,
		first_name: 'ก',
		last_name: 'ข',
		gender: 'other',
		phone: null,
		country: 'TH',
		vulnerable_groups: partial.vulnerable_groups ?? [],
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

	it('returns รอยืนยันถึงโซน when active with zone', () => {
		expect(
			nextQueueLabel(ev({ status: 'active', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('รอยืนยันถึงโซน');
	});

	it('returns พักแล้ว for room_confirmed', () => {
		expect(
			nextQueueLabel(ev({ status: 'room_confirmed', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('พักแล้ว');
	});

	it('returns พักแล้ว for temporary_leave with zone', () => {
		expect(
			nextQueueLabel(ev({ status: 'temporary_leave', zone: 'Z1' }), {
				enableMedicalScreening: false,
				hasScreening: false
			})
		).toBe('พักแล้ว');
	});

	it('ignores a stale zone on an arriving record', () => {
		expect(
			nextQueueLabel(ev({ status: 'arriving', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: false
			})
		).toBe('รอแพทย์');
		expect(
			nextQueueLabel(ev({ status: 'arriving', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('รอโซน');
	});
});

describe('isInShelterStatus', () => {
	it('includes active and room_confirmed only', () => {
		expect(isInShelterStatus(ev({ status: 'active', zone: 'Z1' }))).toBe(true);
		expect(isInShelterStatus(ev({ status: 'room_confirmed', zone: 'Z1' }))).toBe(true);
	});

	it('excludes reported-in (arriving) and pre-registered people', () => {
		expect(isInShelterStatus(ev({ status: 'arriving' }))).toBe(false);
		expect(isInShelterStatus(ev({ status: 'arriving', zone: 'Z1' }))).toBe(false);
		expect(isInShelterStatus(ev({ status: 'pre_registered' }))).toBe(false);
		expect(isInShelterStatus(ev({ status: 'temporary_leave', zone: 'Z1' }))).toBe(false);
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

	it('awaiting_confirm when active with zone (pending Zone Arrival Confirmation)', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'active', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('awaiting_confirm');
	});

	it('assigned when room_confirmed with zone', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'room_confirmed', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).toBe('assigned');
	});

	it('excludes temporary_leave from assigned (confirmed) zoning tab', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'temporary_leave', zone: 'Z1' }), {
				enableMedicalScreening: false,
				hasScreening: false
			})
		).toBeNull();
	});

	it('clears checked-in evacuees from pending (Cleared for Zoning) queue', () => {
		expect(
			classifyZoningQueueTab(ev({ status: 'active', zone: 'Z1' }), {
				enableMedicalScreening: true,
				hasScreening: true
			})
		).not.toBe('pending');
	});
});

describe('classifyScreeningQueueTab', () => {
	it('pending for arriving without screening', () => {
		expect(classifyScreeningQueueTab(ev({ status: 'arriving' }), new Set())).toBe('pending');
	});

	it('screened for arriving with screening', () => {
		expect(
			classifyScreeningQueueTab(ev({ status: 'arriving', id: 'evacuee:1' }), new Set(['evacuee:1']))
		).toBe('screened');
	});

	it('clears active (checked-in) from medical queues even when screened', () => {
		expect(
			classifyScreeningQueueTab(
				ev({ status: 'active', zone: 'Z1', id: 'evacuee:1' }),
				new Set(['evacuee:1'])
			)
		).toBeNull();
	});
});

describe('recommendZoneKind', () => {
	it('recommends quarantine when EWAR surveillance symptoms are present (CR-106)', () => {
		expect(
			recommendZoneKind({ vulnerable_groups: ['wheelchair'], special_needs: [] }, [
				'fever',
				'cough'
			])
		).toBe('quarantine');
		expect(
			recommendZoneKind({ vulnerable_groups: [], special_needs: [] }, ['watery_diarrhea'])
		).toBe('quarantine');
	});

	it('uses vulnerable when EWAR symptoms are empty and evacuee has vulnerable groups', () => {
		expect(recommendZoneKind({ vulnerable_groups: ['infant'], special_needs: [] }, [])).toBe(
			'vulnerable'
		);
	});

	it('defaults to general when EWAR symptoms are empty and no special needs', () => {
		expect(recommendZoneKind({ vulnerable_groups: [], special_needs: [] }, [])).toBe('general');
	});

	it('preserves legacy triage support (red/yellow -> quarantine, green -> non-quarantine)', () => {
		expect(recommendZoneKind({ vulnerable_groups: ['wheelchair'], special_needs: [] }, 'red')).toBe(
			'quarantine'
		);
		expect(recommendZoneKind({ vulnerable_groups: [], special_needs: [] }, 'yellow')).toBe(
			'quarantine'
		);
		expect(recommendZoneKind({ vulnerable_groups: ['infant'], special_needs: [] }, 'green')).toBe(
			'vulnerable'
		);
		expect(recommendZoneKind({ vulnerable_groups: [], special_needs: [] }, null)).toBe('general');
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

describe('countPresentOccupantsByZone', () => {
	it('counts Present occupancy: active, room_confirmed, and temporary_leave', () => {
		const counts = countPresentOccupantsByZone([
			ev({ status: 'active', zone: 'A', id: '1' }),
			ev({ status: 'room_confirmed', zone: 'A', id: '2' }),
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

	it('adds focus=zone for scan hand-off', () => {
		expect(buildZoningPath('evacuee:1', { focusZone: true })).toBe(
			'/onsite/zoning/evacuee:1?focus=zone'
		);
	});
});

describe('zoningQueueSince / sortByZoningQueueSince', () => {
	it('prefers the latest screening time over updated_at', () => {
		const e = ev({ status: 'arriving' });
		expect(zoningQueueSince(e, '2026-09-04T10:00:00.000Z')).toBe('2026-09-04T10:00:00.000Z');
		expect(zoningQueueSince(e)).toBe('2026-09-03T00:00:00.000Z');
	});

	it('orders oldest waiting first without mutating input', () => {
		const a = ev({ status: 'arriving', id: 'evacuee:a' });
		const b = ev({ status: 'arriving', id: 'evacuee:b' });
		const input = [a, b];
		const sorted = sortByZoningQueueSince(input, {
			'evacuee:a': '2026-09-04T12:00:00.000Z',
			'evacuee:b': '2026-09-04T08:00:00.000Z'
		});
		expect(sorted.map((e) => e._id)).toEqual(['evacuee:b', 'evacuee:a']);
		expect(input.map((e) => e._id)).toEqual(['evacuee:a', 'evacuee:b']);
	});
});

describe('formatQueueWait', () => {
	const now = new Date('2026-09-04T12:00:00.000Z');

	it('formats minutes, hours and days', () => {
		expect(formatQueueWait('2026-09-04T11:59:40.000Z', now)).toBe('เพิ่งเข้าคิว');
		expect(formatQueueWait('2026-09-04T11:55:00.000Z', now)).toBe('รอ 5 นาที');
		expect(formatQueueWait('2026-09-04T10:00:00.000Z', now)).toBe('รอ 2 ชม.');
		expect(formatQueueWait('2026-09-04T09:50:00.000Z', now)).toBe('รอ 2 ชม. 10 นาที');
		expect(formatQueueWait('2026-09-03T09:00:00.000Z', now)).toBe('รอ 1 วัน 3 ชม.');
	});

	it('returns — for missing or invalid input', () => {
		expect(formatQueueWait(null, now)).toBe('—');
		expect(formatQueueWait('not-a-date', now)).toBe('—');
	});
});
