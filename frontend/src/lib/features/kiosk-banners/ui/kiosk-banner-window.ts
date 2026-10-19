import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';

const partsOf = (iso: string, withYear: boolean) => {
	const formatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
		timeZone: DISPLAY_TIME_ZONE,
		day: 'numeric',
		month: 'short',
		...(withYear ? { year: 'numeric' as const } : {}),
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const parts = Object.fromEntries(
		formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
	);
	const date = [parts.day, parts.month, withYear ? parts.year : null].filter(Boolean).join(' ');
	return { date, time: `${parts.hour}:${parts.minute}` };
};

const bangkokYear = (iso: string): string =>
	new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_TIME_ZONE, year: 'numeric' }).format(
		new Date(iso)
	);

/**
 * A banner's display window in Asia/Bangkok, e.g. `15 ต.ค. 08:00–18:00`, or with both dates when
 * it crosses midnight. The year (พ.ศ.) appears only when it differs from `now`'s.
 */
export function formatBannerWindow(
	startIso: string,
	endIso: string,
	now: Date = new Date()
): string {
	const currentYear = bangkokYear(now.toISOString());
	const withYear = bangkokYear(startIso) !== currentYear || bangkokYear(endIso) !== currentYear;
	const start = partsOf(startIso, withYear);
	const end = partsOf(endIso, withYear);
	return start.date === end.date
		? `${start.date} ${start.time}–${end.time}`
		: `${start.date} ${start.time} – ${end.date} ${end.time}`;
}
