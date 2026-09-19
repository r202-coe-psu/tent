import type { PortalActivity } from './schedule-view';

export type BookingWindow = {
	start_ts: string;
	end_ts: string;
};

export type BookingConflict = {
	title: string;
	date: string;
	start_ts: string;
	end_ts: string;
	status: PortalActivity['status'];
};

const RELEASED_STATUSES = new Set(['cancelled', 'no_show', 'rejected']);

function timestamp(value: string): number {
	return new Date(value).getTime();
}

export function windowsOverlap(left: BookingWindow, right: BookingWindow): boolean {
	const values = [left.start_ts, left.end_ts, right.start_ts, right.end_ts].map(timestamp);
	if (values.some(Number.isNaN)) return true;
	return values[0] < values[3] && values[2] < values[1];
}

// Applications in booking state deliberately block the same as roster rows.
export function findBookingConflict(
	candidate: BookingWindow,
	activities: readonly PortalActivity[]
): BookingConflict | undefined {
	return activities
		.filter((activity) => !RELEASED_STATUSES.has(activity.status))
		.map((activity) => {
			if (!activity.startTs || !activity.endTs) return undefined;
			const existing = {
				start_ts: activity.startTs,
				end_ts: activity.endTs
			};
			return windowsOverlap(candidate, existing)
				? {
						title: activity.title || 'งานอาสาสมัคร',
						date: activity.date,
						start_ts: activity.startTs,
						end_ts: activity.endTs,
						status: activity.status
					}
				: undefined;
		})
		.find((conflict): conflict is BookingConflict => conflict !== undefined);
}
