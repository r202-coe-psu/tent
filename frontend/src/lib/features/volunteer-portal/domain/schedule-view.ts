import type { ScheduleShift, ShiftStatus, TicketSummary } from './volunteer';

export type PortalActivityStatus = 'booking' | ShiftStatus | string;

export type PortalActivity = {
	id: string;
	jobId: string;
	shiftId: string | null;
	assignmentId: string | null;
	ticketToken: string | null;
	title: string;
	description: string;
	location: string;
	shelterCode: string;
	date: string;
	shiftPeriod: string;
	startTs: string | null;
	endTs: string | null;
	checkinAt: string | null;
	checkoutAt: string | null;
	status: PortalActivityStatus;
	dispatchStatus: string | null;
};

export type PortalActivityFilters = {
	fromDate?: string;
	toDate?: string;
	fromTime?: string;
	toTime?: string;
};

function dateKey(activity: PortalActivity): string {
	if (activity.date) return activity.date;
	if (activity.startTs) return activity.startTs.slice(0, 10);
	return '';
}

function minutes(value: string | undefined): number | null {
	if (!value) return null;
	const match = /^(\d{2}):(\d{2})$/.exec(value);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
}

function startMinutes(activity: PortalActivity): number | null {
	if (!activity.startTs) return null;
	const date = new Date(activity.startTs);
	return Number.isNaN(date.getTime()) ? null : date.getHours() * 60 + date.getMinutes();
}

function startTime(activity: PortalActivity): number {
	const parsed = activity.startTs ? new Date(activity.startTs).getTime() : NaN;
	if (!Number.isNaN(parsed)) return parsed;
	const date = Date.parse(`${dateKey(activity)}T00:00:00`);
	return Number.isNaN(date) ? Number.POSITIVE_INFINITY : date;
}

function sameShift(ticket: TicketSummary, shift: ScheduleShift): boolean {
	if (ticket.shift_id && shift.shift_id) return ticket.shift_id === shift.shift_id;
	if (ticket.job_id && ticket.job_id !== shift.job_id) return false;
	if (ticket.shift_date && ticket.shift_date !== shift.date) return false;
	if (ticket.shelter_code !== shift.shelter_code) return false;
	return !ticket.shift_id || !shift.shift_id;
}

function statusForTicket(ticket: TicketSummary): PortalActivityStatus {
	return ticket.status === 'cancelled' ? 'cancelled' : 'booking';
}

/**
 * Merge applications and roster rows into the one list the volunteer sees.
 *
 * An assignment wins over its application because it has the real duty window and
 * attendance state. Applications that have not been rostered yet remain as a
 * booking-only row so the volunteer can still see that the request is in progress.
 */
export function mergePortalActivities(
	shifts: ScheduleShift[],
	tickets: TicketSummary[]
): PortalActivity[] {
	const activities = shifts.map<PortalActivity>((shift) => ({
		id: shift.assignment_id,
		jobId: shift.job_id,
		shiftId: shift.shift_id ?? null,
		assignmentId: shift.assignment_id,
		ticketToken: null,
		title: shift.job_title || 'งานอาสาสมัคร',
		description: shift.station ? `จุดปฏิบัติงาน: ${shift.station}` : '',
		location: shift.shelter_name || shift.shelter_code,
		shelterCode: shift.shelter_code,
		date: shift.date,
		shiftPeriod: shift.shift === 'custom' ? 'กะงาน' : shift.shift,
		startTs: shift.start_ts,
		endTs: shift.end_ts,
		checkinAt: shift.check_in_at,
		checkoutAt: shift.check_out_at,
		status: shift.status,
		dispatchStatus: shift.dispatch_status
	}));
	const activityByAssignment = new Map(
		activities
			.filter((activity) => activity.assignmentId)
			.map((activity) => [activity.assignmentId as string, activity])
	);

	for (const ticket of tickets) {
		if (ticket.status === 'cancelled') continue;
		const matchingShift = shifts.find((shift) => sameShift(ticket, shift));
		if (matchingShift) {
			const activity = activityByAssignment.get(matchingShift.assignment_id);
			if (activity) activity.ticketToken ??= ticket.view_token;
			continue;
		}
		activities.push({
			id: `ticket:${ticket.view_token}`,
			jobId: ticket.job_id,
			shiftId: ticket.shift_id ?? null,
			assignmentId: null,
			ticketToken: ticket.view_token,
			title: ticket.job_title || 'ภารกิจอาสาสมัคร',
			description: 'การสมัครของคุณอยู่ระหว่างรอเจ้าหน้าที่จัดกะให้',
			location: ticket.shelter_code,
			shelterCode: ticket.shelter_code,
			date: ticket.shift_date,
			shiftPeriod: 'รอจัดกะ',
			startTs: null,
			endTs: null,
			checkinAt: null,
			checkoutAt: null,
			status: statusForTicket(ticket),
			dispatchStatus: null
		});
	}

	return activities;
}

export function filterAndSortPortalActivities(
	activities: PortalActivity[],
	filters: PortalActivityFilters = {},
	now = Date.now()
): PortalActivity[] {
	const fromTime = minutes(filters.fromTime);
	const toTime = minutes(filters.toTime);
	const filtered = activities.filter((activity) => {
		const date = dateKey(activity);
		if (filters.fromDate && (!date || date < filters.fromDate)) return false;
		if (filters.toDate && (!date || date > filters.toDate)) return false;

		if (fromTime !== null || toTime !== null) {
			const time = startMinutes(activity);
			if (time === null) return false;
			if (fromTime !== null && time < fromTime) return false;
			if (toTime !== null && time > toTime) return false;
		}
		return true;
	});

	return filtered.sort((left, right) => {
		const leftTime = startTime(left);
		const rightTime = startTime(right);
		const leftPast = leftTime < now;
		const rightPast = rightTime < now;
		if (leftPast !== rightPast) return leftPast ? 1 : -1;
		if (leftPast) return rightTime - leftTime;
		return leftTime - rightTime;
	});
}
