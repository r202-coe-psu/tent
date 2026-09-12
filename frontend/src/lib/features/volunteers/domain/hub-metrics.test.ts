import { describe, it, expect } from 'vitest';
import { computeHubMetrics, type HubMetricsInput } from './hub-metrics';

const TODAY = '2026-08-26';
const YESTERDAY = '2026-08-25';

describe('computeHubMetrics', () => {
	it('is all zero for empty inputs', () => {
		expect(
			computeHubMetrics({ volunteers: [], assignments: [], applications: [], today: TODAY })
		).toEqual({
			ready: 0,
			assigned: 0,
			checkedInNow: 0,
			completed: 0,
			pendingApproval: 0,
			pendingIdentity: 0
		});
	});

	it('counts ready as all active volunteers — a pool, independent of any shift/checked_in state (owner decision 2026-08-26)', () => {
		const input: HubMetricsInput = {
			volunteers: [
				{ status: 'active', identity_verified: true },
				{ status: 'active', identity_verified: true },
				{ status: 'inactive', identity_verified: true }
			],
			assignments: [],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).ready).toBe(2);
	});

	it('counts assigned as distinct volunteers with a TODAY assignment in assigned/standby', () => {
		const input: HubMetricsInput = {
			volunteers: [],
			assignments: [
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'assigned' },
				{ volunteer_id: 'volunteer:2', date: TODAY, status: 'standby' },
				{ volunteer_id: 'volunteer:3', date: TODAY, status: 'checked_in' },
				{ volunteer_id: 'volunteer:4', date: TODAY, status: 'completed' },
				{ volunteer_id: 'volunteer:5', date: TODAY, status: 'cancelled' }
			],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).assigned).toBe(2);
	});

	it('counts a volunteer with two assignments today (assigned + standby) once, not twice — distinct volunteers, not rows', () => {
		const input: HubMetricsInput = {
			volunteers: [],
			assignments: [
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'assigned' },
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'standby' }
			],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).assigned).toBe(1);
	});

	it('excludes assignments from a different date (not today)', () => {
		const input: HubMetricsInput = {
			volunteers: [],
			assignments: [
				{ volunteer_id: 'volunteer:1', date: YESTERDAY, status: 'assigned' },
				{ volunteer_id: 'volunteer:2', date: TODAY, status: 'assigned' }
			],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).assigned).toBe(1);
	});

	it('counts checkedInNow as distinct volunteers with a TODAY assignment checked_in', () => {
		const input: HubMetricsInput = {
			volunteers: [],
			assignments: [
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'checked_in' },
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'checked_in' }, // dup row, same volunteer
				{ volunteer_id: 'volunteer:2', date: TODAY, status: 'checked_in' },
				{ volunteer_id: 'volunteer:3', date: TODAY, status: 'assigned' }
			],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).checkedInNow).toBe(2);
	});

	it('never reads volunteer.checked_in — a volunteer with no field at all still counts correctly from shift_assignment.status alone', () => {
		const input = {
			volunteers: [{ status: 'active', identity_verified: true }],
			assignments: [{ volunteer_id: 'volunteer:1', date: TODAY, status: 'checked_in' }],
			applications: [],
			today: TODAY
		} as HubMetricsInput;
		const metrics = computeHubMetrics(input);
		expect(metrics.checkedInNow).toBe(1);
		expect(metrics.ready).toBe(1); // pool — not reduced by being checked in
	});

	it('counts completed as distinct volunteers with a TODAY assignment completed (FR-VOL-11.3)', () => {
		const input: HubMetricsInput = {
			volunteers: [],
			assignments: [
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'completed' },
				{ volunteer_id: 'volunteer:2', date: TODAY, status: 'checked_in' }
			],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).completed).toBe(1);
	});

	it('counts pendingApproval as job_applications pending review', () => {
		const input: HubMetricsInput = {
			volunteers: [],
			assignments: [],
			applications: [
				{ status: 'pending_review' },
				{ status: 'pending_review' },
				{ status: 'confirmed' },
				{ status: 'rejected' }
			],
			today: TODAY
		};
		expect(computeHubMetrics(input).pendingApproval).toBe(2);
	});

	it('counts pendingIdentity as active volunteers not yet identity_verified, excluding inactive (F16)', () => {
		const input: HubMetricsInput = {
			volunteers: [
				{ status: 'active', identity_verified: false },
				{ status: 'active', identity_verified: true },
				{ status: 'inactive', identity_verified: false } // must NOT count — inactive
			],
			assignments: [],
			applications: [],
			today: TODAY
		};
		expect(computeHubMetrics(input).pendingIdentity).toBe(1);
	});

	it('computes all counters independently in one call', () => {
		const input: HubMetricsInput = {
			volunteers: [
				{ status: 'active', identity_verified: false },
				{ status: 'active', identity_verified: true },
				{ status: 'inactive', identity_verified: true }
			],
			assignments: [
				{ volunteer_id: 'volunteer:1', date: TODAY, status: 'assigned' },
				{ volunteer_id: 'volunteer:2', date: TODAY, status: 'checked_in' },
				{ volunteer_id: 'volunteer:3', date: TODAY, status: 'no_show' }
			],
			applications: [{ status: 'pending_review' }, { status: 'confirmed' }],
			today: TODAY
		};
		expect(computeHubMetrics(input)).toEqual({
			ready: 2,
			assigned: 1,
			checkedInNow: 1,
			completed: 0,
			pendingApproval: 1,
			pendingIdentity: 1
		});
	});
});
