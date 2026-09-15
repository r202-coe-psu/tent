import { describe, expect, it } from 'vitest';
import { filterAndSortPortalActivities, mergePortalActivities } from './schedule-view';
import type { ScheduleShift, TicketSummary } from './volunteer';

const shift = (overrides: Partial<ScheduleShift> = {}): ScheduleShift => ({
	assignment_id: 'shift_assignment:1',
	job_id: 'job:1',
	shift_id: 'shift:1',
	job_title: 'ครัวกลาง',
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์หลัก',
	date: '2026-09-10',
	shift: 'morning',
	station: 'ครัว',
	start_ts: '2026-09-10T01:00:00.000Z',
	end_ts: '2026-09-10T05:00:00.000Z',
	check_in_at: null,
	check_out_at: null,
	status: 'assigned',
	dispatch_status: null,
	...overrides
});

const ticket = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
	view_token: 'VIEW-1',
	job_id: 'job:1',
	applicant_name: 'อาสา',
	status: 'confirmed',
	job_title: 'ครัวกลาง',
	shelter_code: 'SH001',
	shift_date: '2026-09-10',
	shift_id: 'shift:1',
	...overrides
});

describe('portal schedule view', () => {
	it('merges a ticket into its assigned shift instead of rendering two cards', () => {
		const activities = mergePortalActivities([shift()], [ticket()]);
		expect(activities).toHaveLength(1);
		expect(activities[0]?.assignmentId).toBe('shift_assignment:1');
		expect(activities[0]?.ticketToken).toBe('VIEW-1');
		expect(activities[0]?.shiftPeriod).toBe('กะเช้า');
	});

	it('labels a manually configured shift clearly', () => {
		const activities = mergePortalActivities([shift({ shift: 'custom' })], []);
		expect(activities[0]?.shiftPeriod).toBe('ช่วงเวลาที่กำหนดเอง');
	});

	it('keeps an unassigned booking visible as a pending activity', () => {
		const activities = mergePortalActivities([], [ticket({ shift_id: null })]);
		expect(activities).toHaveLength(1);
		expect(activities[0]).toMatchObject({ status: 'booking', shiftPeriod: 'รอจัดกะ' });
	});

	it('filters by date and time and puts the next activity first', () => {
		const activities = mergePortalActivities(
			[
				shift({
					assignment_id: 'shift_assignment:late',
					date: '2026-09-12',
					start_ts: '2026-09-12T04:00:00.000Z'
				}),
				shift({
					assignment_id: 'shift_assignment:soon',
					date: '2026-09-10',
					start_ts: '2026-09-10T03:00:00.000Z'
				})
			],
			[]
		);
		const result = filterAndSortPortalActivities(
			activities,
			{ fromDate: '2026-09-10', toDate: '2026-09-12', fromTime: '10:00', toTime: '12:00' },
			Date.parse('2026-09-09T00:00:00Z')
		);
		expect(result.map((item) => item.id)).toEqual([
			'shift_assignment:soon',
			'shift_assignment:late'
		]);
		expect(
			filterAndSortPortalActivities(activities, {
				status: 'assigned',
				title: 'ครัวกลาง'
			})
		).toHaveLength(2);
		expect(filterAndSortPortalActivities(activities, { title: 'งานที่ไม่มีอยู่' })).toHaveLength(0);

		const morningInBangkok = mergePortalActivities(
			[shift({ start_ts: '2026-09-10T01:00:00.000' })],
			[]
		);
		expect(
			filterAndSortPortalActivities(
				morningInBangkok,
				{ fromTime: '08:00', toTime: '08:00' },
				Date.parse('2026-09-09T00:00:00Z')
			)
		).toHaveLength(1);
	});
});
