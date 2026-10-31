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
