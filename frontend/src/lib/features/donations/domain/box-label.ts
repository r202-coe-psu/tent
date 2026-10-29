/**
 * The shipping label stuck on a donation box (#591). Everything here is what a stranger
 * handling the box may read, so it carries the booking ref, the goods and the destination
 * and nothing about the donor. `qrValue` is the booking ref, never the tracking token:
 * the token lets whoever holds it cancel or edit the booking.
 */
import type { DropOffPoint } from './drop-off';
import {
	formatTrackSchedule,
	rejectedLineReasons,
	type DonationTrackItem,
	type DonationTrackView
} from './tracking';

/** One line and the point it goes to (CR-206 FR-MP-1, carried on {@link DonationTrackItem}). */
export type BoxLabelSourceItem = DonationTrackItem;

export type BoxLabelSource = Omit<DonationTrackView, 'items'> & { items: BoxLabelSourceItem[] };

export type BoxLabelLine = {
	name: string;
	qty: string | number | null;
	/** Raw unit code; the UI turns it into a display name with the catalog. */
	unit: string | null;
};

/** A6 portrait. The page hands this to `@page`, so the browser's own print dialog picks the paper. */
export const BOX_LABEL_MM = { width: 105, height: 148 } as const;

/** Rows of goods one label holds before it says "and k more". */
export const BOX_LABEL_MAX_LINES = 8;

export function boxLabelPageCss(): string {
	return `@page{size:${BOX_LABEL_MM.width}mm ${BOX_LABEL_MM.height}mm;margin:0}`;
}

export type BoxLabel = {
	bookingRef: string;
	qrValue: string;
	destination: DropOffPoint;
	/** Lines the shelter did not turn away. */
	lines: BoxLabelLine[];
	deliveryMethod: string | null;
	/** Appointment date and window, or the parcel ETA; `null` when the booking has none. */
	schedule: string | null;
	/** 1-based position among the labels of this booking. */
	sheet: { index: number; total: number };
};

/** The shelter has accepted the booking and expects the goods: the same moment the check-in QR appears. */
export function canPrintBoxLabel(status: string): boolean {
	return status === 'verifying';
}

export function buildBoxLabels(
	donation: BoxLabelSource,
	resolvePoint: (pointId: string | null) => DropOffPoint
): BoxLabel[] {
	const bookingRef = donation.booking_ref;
	if (!canPrintBoxLabel(donation.status) || !bookingRef) return [];

	const rejected = rejectedLineReasons(donation);
	const linesByPoint = new Map<string | null, BoxLabelLine[]>();
	donation.items.forEach((item, index) => {
		if (rejected[index] !== null) return;
		const pointId = item.drop_off_point_id ?? null;
		const line: BoxLabelLine = { name: item.item_name, qty: item.qty, unit: item.unit };
		const group = linesByPoint.get(pointId);
		if (group) group.push(line);
		else linesByPoint.set(pointId, [line]);
	});

	const schedule = formatTrackSchedule(donation.logistics);
	const total = linesByPoint.size;
	// Map keeps first-seen order, so the sheets follow the order the donor listed their goods.
	return [...linesByPoint].map(([pointId, lines], index) => ({
		bookingRef,
		qrValue: bookingRef,
		destination: resolvePoint(pointId),
		lines,
		deliveryMethod: donation.logistics?.delivery_method ?? null,
		schedule: schedule === '-' ? null : schedule,
		sheet: { index: index + 1, total }
	}));
}

/**
 * A label has room for `max` rows. When the goods outnumber that the last row says how many
 * are not listed, so a half-listed box never reads as a complete one.
 */
export function clipLabelLines(
	lines: readonly BoxLabelLine[],
	max: number
): { shown: BoxLabelLine[]; hidden: number } {
	if (lines.length <= max) return { shown: [...lines], hidden: 0 };
	// One row is spent on the "and k more" line, so show max - 1 goods.
	const shown = lines.slice(0, max - 1);
	return { shown, hidden: lines.length - shown.length };
}
