import { describe, expect, it } from 'vitest';
import {
	distinctStation,
	filterAndSortPortalActivities,
	mergePortalActivities,
	portalTicketActions,
	type PortalActivity,
	type PortalApplication
} from './schedule-view';
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

describe('distinctStation', () => {
	it('hides a station that only repeats the job title (the recorded default)', () => {
		expect(distinctStation('ครัวกลาง', 'ครัวกลาง')).toBe(false);
		expect(distinctStation(' Test Kin Koal ', 'test kin koal')).toBe(false);
		expect(distinctStation('', 'ครัวกลาง')).toBe(false);
		expect(distinctStation(null, 'ครัวกลาง')).toBe(false);
	});

	it('shows a real station', () => {
		expect(distinctStation('ครัว อาคาร 2', 'ครัวกลาง')).toBe(true);
	});

	it('drops the repeated station from the portal card', () => {
		const [activity] = mergePortalActivities([shift({ station: 'ครัวกลาง' })], []);
		expect(activity?.description).toBe('');
	});
});

describe('portalTicketActions (#973)', () => {
	const activity = (over: Partial<PortalActivity> = {}): PortalActivity => ({
		id: 'a1',
		jobId: 'job:1',
		shiftId: 'shift:2',
		assignmentId: null,
		title: 't',
		description: '',
		location: '',
		shelterCode: 'SH001',
		date: '2026-12-01',
		shiftPeriod: '',
		startTs: '2026-12-01T03:00:00Z',
		endTs: '2026-12-01T07:00:00Z',
		checkinAt: null,
		checkoutAt: null,
		status: 'booking',
		dispatchStatus: null,
		...over
	});
	const app = (over: Partial<PortalApplication> = {}): PortalApplication => ({
		application_id: 'job_application:9',
		status: 'confirmed',
		job_id: 'job:1',
		shift_id: 'shift:2',
		date: '2026-12-01',
		can_cancel: true,
		...over
	});
	const before = Date.parse('2026-11-30T00:00:00Z');

	it('gives no buttons without applications (phone session)', () => {
		expect(portalTicketActions(activity(), [], before)).toBeNull();
	});

	it('offers open and cancel for a matching live application', () => {
		expect(portalTicketActions(activity(), [app()], before)).toEqual({
			applicationId: 'job_application:9',
			canOpen: true,
			canCancel: true
		});
	});

	it('matches the right shift when a job has several', () => {
		const apps = [
			app({ application_id: 'x1', shift_id: 'shift:1' }),
			app({ application_id: 'x2', shift_id: 'shift:2' })
		];
		expect(portalTicketActions(activity(), apps, before)?.applicationId).toBe('x2');
	});

	it('does not match by date when shift_id does not match (W2)', () => {
		// Same job, same date, but application is for a different shift
		const mismatchedApp = app({
			application_id: 'x1',
			shift_id: 'shift:different',
			date: '2026-12-01'
		});
		expect(
			portalTicketActions(
				activity({ shiftId: 'shift:2', date: '2026-12-01' }),
				[mismatchedApp],
				before
			)
		).toBeNull();
	});

	it('refuses to match when one side has shift_id and the other does not (W2)', () => {
		const appWithoutShift = app({ application_id: 'x1', shift_id: null, date: '2026-12-01' });
		expect(
			portalTicketActions(
				activity({ shiftId: 'shift:2', date: '2026-12-01' }),
				[appWithoutShift],
				before
			)
		).toBeNull();

		const appWithShift = app({ application_id: 'x1', shift_id: 'shift:2', date: '2026-12-01' });
		expect(
			portalTicketActions(activity({ shiftId: null, date: '2026-12-01' }), [appWithShift], before)
		).toBeNull();
	});

	it('legacy records match by date only when both sides lack shift_id', () => {
		const legacyApp = app({ application_id: 'x-legacy', shift_id: null, date: '2026-12-01' });
		const legacyActivity = activity({ shiftId: null, date: '2026-12-01' });
		expect(portalTicketActions(legacyActivity, [legacyApp], before)?.applicationId).toBe(
			'x-legacy'
		);

		// Different date does not match
		const otherDateApp = app({ application_id: 'x-other', shift_id: null, date: '2026-12-02' });
		expect(portalTicketActions(legacyActivity, [otherDateApp], before)).toBeNull();
	});

	it('hides cancel once the shift started, keeps open', () => {
		const after = Date.parse('2026-12-01T03:30:00Z');
		expect(portalTicketActions(activity(), [app()], after)).toMatchObject({
			canOpen: true,
			canCancel: false
		});
	});

	it('hides cancel when checked in or when the server says no', () => {
		expect(
			portalTicketActions(activity({ status: 'checked_in' }), [app()], before)?.canCancel
		).toBe(false);
		expect(portalTicketActions(activity(), [app({ can_cancel: false })], before)?.canCancel).toBe(
			false
		);
	});

	it('gives nothing for a cancelled application or activity', () => {
		expect(portalTicketActions(activity(), [app({ status: 'cancelled' })], before)).toBeNull();
		expect(portalTicketActions(activity({ status: 'cancelled' }), [app()], before)).toBeNull();
	});
});
