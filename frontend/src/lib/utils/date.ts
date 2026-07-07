/**
 * Date formatting and utility functions.
 */

/** จำนวนวันระหว่าง 2 วัน (inclusive) */
export function daysBetween(from: string, to: string): number {
	const f = new Date(from);
	const t = new Date(to);
	const diffTime = Math.abs(t.getTime() - f.getTime());
	return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/** สร้าง array ของ YYYY-MM-DD ทุกวันระหว่าง from → to */
export function buildDateRange(from: string, to: string): string[] {
	const f = new Date(from);
	const t = new Date(to);
	const dates: string[] = [];
	for (let d = f; d <= t; d.setUTCDate(d.getUTCDate() + 1)) {
		dates.push(d.toISOString().slice(0, 10));
	}
	return dates;
}

/** แปลง YYYY-MM-DD → วันจันทร์ของสัปดาห์นั้น (ISO week) */
export function getISOWeekMonday(date: string): string {
	const d = new Date(date);
	const day = d.getUTCDay();
	const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
	const monday = new Date(d);
	monday.setUTCDate(diff);
	return monday.toISOString().slice(0, 10);
}

const THAI_MONTHS = [
	'ม.ค.',
	'ก.พ.',
	'มี.ค.',
	'เม.ย.',
	'พ.ค.',
	'มิ.ย.',
	'ก.ค.',
	'ส.ค.',
	'ก.ย.',
	'ต.ค.',
	'พ.ย.',
	'ธ.ค.'
];

/** แปลง YYYY-MM-DD → "07 ก.ค." */
export function formatThaiDate(isoDate: string): string {
	if (!isoDate || isoDate.length !== 10) return isoDate;
	const parts = isoDate.split('-');
	const monthIndex = parseInt(parts[1], 10) - 1;
	const dayStr = parseInt(parts[2], 10).toString();
	if (monthIndex < 0 || monthIndex >= 12) return isoDate;
	return `${dayStr} ${THAI_MONTHS[monthIndex]}`;
}

/** สร้าง label สัปดาห์ "27 พ.ค.–2 มิ.ย." */
export function formatThaiWeekRange(start: string, end: string): string {
	return `${formatThaiDate(start)}–${formatThaiDate(end)}`;
}
