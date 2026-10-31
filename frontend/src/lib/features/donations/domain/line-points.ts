/**
 * Which drop-off point each line of a booking goes to (CR-206). Staff set it: from the
 * campaign at booking, at review otherwise (staff-assigned drop-off FR-AP-8). The ticket, the
 * tracking page and the box label group the lines by it (FR-MP-13, FR-MP-14, FR-MP-16).
 */
import {
	listDropOffPoints,
	resolveDropOffPoint,
	type DropOffPoint,
	type DropOffShelterSource
} from './drop-off';
import { currentLinePoint } from './point-receipts';

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

/** Group key of lines waiting for staff to set their point at review (staff-assigned drop-off FR-AP-22). */
export const AWAITING_STAFF_KEY = '?staff';

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
	/** The point id, {@link ANY_POINT_KEY}, {@link AT_SHELTER_KEY} or {@link AWAITING_STAFF_KEY}. */
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
 * In a self drop-off to a shelter with points, a `pending` line with no point that no point
 * has recorded waits for staff to set one at review: it goes in one "awaiting staff" group,
 * shown last (staff-assigned drop-off FR-AP-22, FR-AP-22a).
 * Groups follow the order of their first line. A line staff refused at review is left out:
 * nothing of it is to be brought.
 * `null` when the booking names no point and no line awaits one — it shows the shelter as before.
 */
export function groupDropOffDestinations(
	items: readonly GroupSourceItem[],
	shelter: DropOffShelterSource,
	opts: {
		anyPointName: string;
		awaitingName: string;
		deliveryMethod: string | null | undefined;
		pointReceipts?: readonly GroupSourceReceipt[] | null;
	}
): DropOffDestinationGroup[] | null {
	const currentIds = currentDropOffPointIds(shelter);
	const recordedAt = new Map<number, string | null>();
	for (const receipt of opts.pointReceipts ?? []) {
		for (const lineNo of receipt.line_nos) recordedAt.set(lineNo, receipt.point_id);
	}
	const awaitsStaff = opts.deliveryMethod === 'self_dropoff' && currentIds.size > 0;

	const keyOf = (item: GroupSourceItem, lineNo: number): string => {
		if (recordedAt.get(lineNo) === null) return AT_SHELTER_KEY;
		const pointId = currentLinePoint(item, currentIds);
		if (pointId !== null) return pointId;
		const awaiting = awaitsStaff && item.review_status === 'pending' && !recordedAt.has(lineNo);
		return awaiting ? AWAITING_STAFF_KEY : ANY_POINT_KEY;
	};

	const lineNosByKey = new Map<string, number[]>();
	items.forEach((item, lineNo) => {
		if (item.review_status === 'rejected') return;
		const key = keyOf(item, lineNo);
		const group = lineNosByKey.get(key);
		if (group) group.push(lineNo);
		else lineNosByKey.set(key, [lineNo]);
	});
	if (!hasLinePoints(items) && !lineNosByKey.has(AWAITING_STAFF_KEY)) return null;

	const shelterPoint = resolveDropOffPoint(shelter);
	const resolvePoint = lineDestinationResolver(shelter, opts.anyPointName);
	const pointOf = (key: string): DropOffPoint => {
		if (key === AT_SHELTER_KEY) return shelterPoint;
		if (key === AWAITING_STAFF_KEY) return { ...shelterPoint, name: opts.awaitingName };
		return resolvePoint(key === ANY_POINT_KEY ? null : key);
	};

	return [...lineNosByKey]
		.sort(([a], [b]) => Number(a === AWAITING_STAFF_KEY) - Number(b === AWAITING_STAFF_KEY))
		.map(([key, lineNos]): DropOffDestinationGroup => {
			const recorded = lineNos.every((lineNo) => recordedAt.has(lineNo));
			return {
				key,
				anyPoint: !currentIds.has(key),
				point: pointOf(key),
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
