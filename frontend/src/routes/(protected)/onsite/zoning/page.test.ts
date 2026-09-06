import { describe, expect, it } from 'vitest';
import {
	buildZoningPath,
	classifyZoningQueueTab,
	parseZoningQrCode,
	recommendZoneKind
} from '$lib/features/people';

describe('Station 3 zoning helpers (route contract)', () => {
	it('builds zoning path', () => {
		expect(buildZoningPath('evacuee:1')).toBe('/onsite/zoning/evacuee:1');
	});

	it('parses zoning QR forms', () => {
		expect(parseZoningQrCode('/onsite/zoning/evacuee:1')).toBe('evacuee:1');
		expect(parseZoningQrCode('evacuee:1')).toBe('evacuee:1');
	});

	it('classifies pending when medical flag off', () => {
		const e = {
			_id: 'evacuee:1',
			current_stay: { status: 'arriving', zone: null, since: '2026-09-03T00:00:00.000Z' }
		} as Parameters<typeof classifyZoningQueueTab>[0];
		expect(classifyZoningQueueTab(e, { enableMedicalScreening: false, hasScreening: false })).toBe(
			'pending'
		);
	});

	it('classifies active+zone as awaiting_confirm (Zone Arrival Confirmation)', () => {
		const e = {
			_id: 'evacuee:1',
			current_stay: { status: 'active', zone: 'Z1', since: '2026-09-03T00:00:00.000Z' }
		} as Parameters<typeof classifyZoningQueueTab>[0];
		expect(classifyZoningQueueTab(e, { enableMedicalScreening: false, hasScreening: false })).toBe(
			'awaiting_confirm'
		);
	});

	it('recommends quarantine for red/yellow triage (isolation default)', () => {
		expect(recommendZoneKind({ vulnerable_groups: [], special_needs: [] }, 'red')).toBe(
			'quarantine'
		);
		expect(recommendZoneKind({ vulnerable_groups: ['infant'], special_needs: [] }, 'yellow')).toBe(
			'quarantine'
		);
	});

	it('recommends vulnerable for Vulnerable Groups when triage is green', () => {
		expect(
			recommendZoneKind({ vulnerable_groups: ['wheelchair'], special_needs: [] }, 'green')
		).toBe('vulnerable');
	});

	it('defaults to general when no triage and no vulnerable tags', () => {
		expect(recommendZoneKind({ vulnerable_groups: [], special_needs: [] }, null)).toBe('general');
	});
});
