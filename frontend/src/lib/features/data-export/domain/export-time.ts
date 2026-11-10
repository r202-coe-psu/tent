/**
 * domain/export-time.ts — data-export
 *
 * Asia/Bangkok (+07) timestamps for file names and sheet headings (CR-232 FR-5).
 */
import { DISPLAY_TIME_ZONE } from '$lib/utils/date';

function bangkokParts(at: Date): Record<string, string> {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: DISPLAY_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(at);
	return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** `YYYYMMDD-HHmm` in +07, for file names. */
export function fileStamp(at: Date): string {
	const p = bangkokParts(at);
	return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

/** `YYYY-MM-DD HH:mm` in +07, for sheet headings. */
export function headingTimestamp(at: Date): string {
	const p = bangkokParts(at);
	return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
