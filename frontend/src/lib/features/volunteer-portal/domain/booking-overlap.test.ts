import { describe, expect, it } from 'vitest';
import { findBookingConflict, windowsOverlap } from './booking-overlap';
import type { PortalActivity } from './schedule-view';

const baseActivity: PortalActivity = {
	id: 'booking:1',
	jobId: 'job:existing',
	shiftId: 'shift:existing',
	assignmentId: null,
	ticketToken: 'VIEW-1',
	title: 'ผู้จัดหมวดหมู่กล่องยังชีพ',
	description: '',
	location: 'ศูนย์พักพิง',
	shelterCode: 'SH001',
	date: '2026-09-09',
	shiftPeriod: 'กะเช้า',
	startTs: '2026-09-09T01:00:00.000Z',
	endTs: '2026-09-09T09:00:00.000Z',
	checkinAt: null,
	checkoutAt: null,
	status: 'booking',
	dispatchStatus: null
};

describe('booking overlap', () => {
	it('blocks a pending booking, not only an approved roster row', () => {
		expect(
			findBookingConflict(
				{
					start_ts: '2026-09-09T08:00:00.000Z',
					end_ts: '2026-09-09T16:00:00.000Z'
				},
				[baseActivity]
			)?.title
		).toBe('ผู้จัดหมวดหมู่กล่องยังชีพ');
	});

	it('allows shifts that only touch at the boundary', () => {
		expect(
			windowsOverlap(
				{ start_ts: '2026-09-09T01:00:00.000Z', end_ts: '2026-09-09T09:00:00.000Z' },
				{ start_ts: '2026-09-09T09:00:00.000Z', end_ts: '2026-09-09T17:00:00.000Z' }
			)
		).toBe(false);
	});

	it('ignores cancelled and no-show rows', () => {
		expect(
			findBookingConflict({ start_ts: baseActivity.startTs!, end_ts: baseActivity.endTs! }, [
				{ ...baseActivity, status: 'cancelled' },
				{ ...baseActivity, status: 'no_show' }
			])
		).toBeUndefined();
	});
});
