/**
 * Which drop-off point each line of a booking goes to, on the donor's side (CR-206). The
 * form picks one point per line (FR-MP-8 – FR-MP-12); the ticket, the tracking page and the
 * box label group the lines by it (FR-MP-13, FR-MP-14, FR-MP-16).
 */
import {
	listDropOffPoints,
	resolveDropOffPoint,
	type DropOffPoint,
	type DropOffShelterSource
} from './drop-off';
import { currentLinePoint } from './point-receipts';

/** A point a donor can book a line to: an entry of `public_shelters.donation_points`. */
export type BookablePoint = { id: string; name: string };

/**
 * The points a line may be booked to (FR-MP-8, FR-MP-11). Only a donor who brings the
 * goods picks a point: a parcel or a shelter pickup reaches the shelter whole (FR-MP-4).
 * `[]` also for a shelter with no ticked point — its lines carry no point.
 */
export function bookableDropOffPoints(
	shelter: Pick<DropOffShelterSource, 'donation_points'> | null | undefined,
	deliveryMethod: string | null | undefined
): BookablePoint[] {
	if (deliveryMethod !== 'self_dropoff') return [];
	return (shelter?.donation_points ?? []).map((point) => ({ id: point.id, name: point.name }));
}

/**
 * The point every line starts at (FR-MP-9): the one the donor tapped on the map, else the
 * first in the list. A tap on another shelter's map does not count here.
 */
export function defaultDropOffPointId(
	points: readonly BookablePoint[],
	tappedPointId: string | null | undefined
): string | null {
	if (tappedPointId && points.some((point) => point.id === tappedPointId)) return tappedPointId;
	return points[0]?.id ?? null;
}

/**
 * The point a line is booked to: the donor's own pick while the shelter still offers it,
 * else the default. `null` when there is no point to pick (FR-MP-11) — with one point that
 * point is filled in without asking (FR-MP-10). A pick made for another shelter is not in
 * `points`, so changing the shelter drops every pick (FR-MP-12).
 */
export function lineDropOffPointId(
	chosen: string | null | undefined,
	points: readonly BookablePoint[],
	defaultPointId: string | null
): string | null {
	if (points.length === 0) return null;
	if (chosen && points.some((point) => point.id === chosen)) return chosen;
	return defaultPointId;
}

/** Picker key of "ส่งทุกรายการที่จุดเดียวกัน"; a line's picker is keyed by the line's own key. */
export const ALL_LINES_PICKER = '*all';

/**
 * The picker a tap on the map fills (owner 2026-10-30): the one the donor used last, while it
 * is still on the form; before any is used, the first line's.
 */
export function pickerForMapTap(
	activePicker: string | null,
	lineKeys: readonly string[]
): string | null {
	if (activePicker === ALL_LINES_PICKER) return activePicker;
	if (activePicker !== null && lineKeys.includes(activePicker)) return activePicker;
	return lineKeys[0] ?? null;
}

type CampaignPointSource = {
	needs: readonly { item_id: string; drop_off_point_id?: string | null }[];
};

/**
 * The point each line is booked to (draft CR "staff-assigned drop-off" FR-AP-8, FR-AP-9):
 * staff, not the donor, decide it. A campaign line takes the point of the first need of the
 * booking's own campaign that asks for its item; any other line waits for staff at review.
 * Only a self drop-off has points (CR-206 FR-MP-4). The id is copied as staff set it, never
 * checked against the shelter's points here (D-5, D-10): a point gone since reads as "any point".
 */
export function withCampaignLinePoints<T extends { item_id?: string | null }>(
	lines: readonly T[],
	campaign: CampaignPointSource | null | undefined,
	deliveryMethod: string | null | undefined
): (T & { drop_off_point_id: string | null })[] {
	return lines.map((line) => {
		const need =
			deliveryMethod === 'self_dropoff' && line.item_id
				? campaign?.needs.find((n) => n.item_id === line.item_id)
				: undefined;
		return { ...line, drop_off_point_id: need?.drop_off_point_id ?? null };
	});
}

/** Ids of the points the shelter offers now (FR-MP-16) — the main point has none. */
export function currentDropOffPointIds(shelter: DropOffShelterSource): Set<string> {
	return new Set(
		listDropOffPoints(shelter).flatMap((point) => (point.pointId ? [point.pointId] : []))
	);
}

/**
 * Whether the booking was split across points: a line names one, offered now or not. A
 * booking that names none (before CR-206, a parcel, a shelter with no point) keeps the one
 * destination it always had — the shelter.
 */
export function hasLinePoints(
	items: readonly { drop_off_point_id?: string | null }[] | null | undefined
): boolean {
	return (items ?? []).some((item) => (item.drop_off_point_id ?? null) !== null);
}

/** Group key of lines that may go to any point of the shelter (FR-MP-16). */
export const ANY_POINT_KEY = '*';

/** Group key of lines recorded after the shelter had no drop-off point left (FR-MP-18b). */
export const AT_SHELTER_KEY = '@shelter';

/**
 * Where a group of lines goes. A point the shelter offers resolves to that point; `null`
 * (no point, or one unticked or deleted since booking) resolves to the shelter itself under
 * `anyPointName` — never "the main point" (CR-205 D-3 keeps that for shelters with no point).
 */
export function lineDestinationResolver(
	shelter: DropOffShelterSource,
	anyPointName: string
): (pointId: string | null) => DropOffPoint {
	const points = listDropOffPoints(shelter);
	const shelterPoint = resolveDropOffPoint(shelter);
	return (pointId) =>
		(pointId !== null ? points.find((point) => point.pointId === pointId) : undefined) ?? {
			...shelterPoint,
			name: anyPointName
		};
}

/**
 * `pending` = a line still waits for a point to record it · `received` = every line has a
 * result (FR-MP-5a) · `received_at_shelter` = every line was recorded after the shelter had
 * no drop-off point left (`point_id = null`, FR-MP-18b).
 */
export type DropOffGroupStatus = 'pending' | 'received' | 'received_at_shelter';

export type DropOffDestinationGroup = {
	/** The point id, or {@link ANY_POINT_KEY}. */
	key: string;
	anyPoint: boolean;
	point: DropOffPoint;
	/** Positions in `items`, in the order the donor listed them. */
	lineNos: number[];
	status: DropOffGroupStatus;
};

type GroupSourceItem = {
	drop_off_point_id?: string | null;
	review_status?: string | null;
};

type GroupSourceReceipt = { point_id: string | null; line_nos: readonly number[] };

/**
 * The booking's destinations, one group per point (FR-MP-13), with the lines no offered
 * point names in one "any point" group (FR-MP-16). A line recorded with no point (FR-MP-18b)
 * leaves its group for one "received at the shelter" group, which no other line joins.
 * Groups follow the order of their first line. A line staff refused at review is left out:
 * nothing of it is to be brought.
 * `null` when the booking names no point at all — it shows the shelter as before.
 */
export function groupDropOffDestinations(
	items: readonly GroupSourceItem[],
	shelter: DropOffShelterSource,
	opts: { anyPointName: string; pointReceipts?: readonly GroupSourceReceipt[] | null }
): DropOffDestinationGroup[] | null {
	if (!hasLinePoints(items)) return null;

	const currentIds = currentDropOffPointIds(shelter);
	const resolvePoint = lineDestinationResolver(shelter, opts.anyPointName);
	const recordedAt = new Map<number, string | null>();
	for (const receipt of opts.pointReceipts ?? []) {
		for (const lineNo of receipt.line_nos) recordedAt.set(lineNo, receipt.point_id);
	}

	const lineNosByKey = new Map<string, number[]>();
	items.forEach((item, lineNo) => {
		if (item.review_status === 'rejected') return;
		const key =
			recordedAt.get(lineNo) === null
				? AT_SHELTER_KEY
				: (currentLinePoint(item, currentIds) ?? ANY_POINT_KEY);
		const group = lineNosByKey.get(key);
		if (group) group.push(lineNo);
		else lineNosByKey.set(key, [lineNo]);
	});

	return [...lineNosByKey].map(([key, lineNos]): DropOffDestinationGroup => {
		const pointId = key === ANY_POINT_KEY || key === AT_SHELTER_KEY ? null : key;
		const recorded = lineNos.every((lineNo) => recordedAt.has(lineNo));
		return {
			key,
			anyPoint: pointId === null,
			point: key === AT_SHELTER_KEY ? resolveDropOffPoint(shelter) : resolvePoint(pointId),
			lineNos,
			status: !recorded ? 'pending' : key === AT_SHELTER_KEY ? 'received_at_shelter' : 'received'
		};
	});
}

/**
 * The lines as the box label groups them (FR-MP-14, FR-MP-16): a point the shelter no longer
 * offers reads as no point, so every such line lands on the one "any point" label.
 */
export function withCurrentLinePoints<T extends { drop_off_point_id?: string | null }>(
	items: readonly T[],
	shelter: DropOffShelterSource
): T[] {
	const currentIds = currentDropOffPointIds(shelter);
	return items.map((item) => ({ ...item, drop_off_point_id: currentLinePoint(item, currentIds) }));
}
