import type { PublicGeoPoint, PublicShelterItem, PublicSiteKind } from './types';

/**
 * A pin on the donation map that is not the shelter itself (a drop-off point inside or
 * next to a shelter). `shelterCode` ties it back to the shelter whose card it opens.
 * The shelter's own pin is never listed here: it comes from `DonationMapShelter.geo`.
 */
export type DonationMapPoint = {
	id: string;
	shelterCode: string;
	geo: PublicGeoPoint;
	label: string;
	description?: string;
};

export type DonationNeedUrgency = 'critical' | 'high' | 'normal';

export type DonationMapNeed = {
	itemId: string;
	name: string;
	unit: string;
	qtyNeeded: number;
	urgency: DonationNeedUrgency;
};

/** One row of `GET /api/public/v1/needs` as the form receives it (BFF returns the array). */
export type DonationNeedsEntry = {
	code: string;
	name: string;
	needs: Array<{
		item_id?: string;
		name?: string;
		unit?: string;
		qty_needed?: string | number;
		status?: string;
		urgency?: string;
	}>;
};

/**
 * A shelter that takes donations, joined with its public record. `geo` is null when the
 * shelter is missing from the public list or has no coordinates: such a shelter is
 * still pickable from the list but has no pin.
 */
export type DonationMapShelter = {
	code: string;
	name: string;
	siteKind: PublicSiteKind;
	status: string;
	geo: PublicGeoPoint | null;
	areaLabel: string;
	needs: DonationMapNeed[];
	points: DonationMapPoint[];
};

export type DonationMap = {
	onMap: DonationMapShelter[];
	withoutGeo: DonationMapShelter[];
};

const codeKey = (code: string) => code.trim().toUpperCase();

function hasUsableGeo(geo: PublicGeoPoint | null | undefined): geo is PublicGeoPoint {
	return (
		geo != null &&
		Number.isFinite(geo.lat) &&
		Number.isFinite(geo.lng) &&
		!(geo.lat === 0 && geo.lng === 0)
	);
}

/**
 * Same reading as the needs board: the level staff set wins (`important` is the
 * back-office word for `high`); only a need without one is ranked by what is still short.
 */
function toUrgency(level: string | undefined, qtyNeeded: number): DonationNeedUrgency {
	const set = (level ?? '').trim();
	if (set === 'critical') return 'critical';
	if (set === 'important' || set === 'high') return 'high';
	if (set === 'normal') return 'normal';
	return qtyNeeded >= 50 ? 'critical' : qtyNeeded > 0 ? 'high' : 'normal';
}

const URGENCY_RANK: Record<DonationNeedUrgency, number> = { critical: 0, high: 1, normal: 2 };

function toOpenNeeds(entry: DonationNeedsEntry): DonationMapNeed[] {
	const open: DonationMapNeed[] = [];
	for (const need of entry.needs ?? []) {
		if (need.status === 'closed' || !need.item_id) continue;
		const qtyNeeded = Number(need.qty_needed) || 0;
		open.push({
			itemId: need.item_id,
			name: (need.name || need.item_id).replace(/^item:/, ''),
			unit: need.unit ?? '',
			qtyNeeded,
			urgency: toUrgency(need.urgency, qtyNeeded)
		});
	}
	// Array.prototype.sort is stable, so equal urgencies keep the board's order.
	return open.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);
}

/** A shelter is as urgent as its most urgent open need; one with none open is normal. */
export function donationShelterUrgency(needs: DonationMapNeed[]): DonationNeedUrgency {
	return needs.reduce<DonationNeedUrgency>(
		(top, need) => (URGENCY_RANK[need.urgency] < URGENCY_RANK[top] ? need.urgency : top),
		'normal'
	);
}

function areaLabelOf(shelter: PublicShelterItem | undefined): string {
	if (!shelter) return '';
	return [shelter.subdistrict, shelter.district, shelter.province]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(' ');
}

/**
 * Who can be picked comes from `needs` (shelters that asked for donations); `shelters`
 * only adds geo and the area label, `pointsByShelter` (keyed by shelter code) adds
 * drop-off pins. `lockedCode` narrows the result to that shelter.
 */
export function buildDonationMap(
	needs: DonationNeedsEntry[],
	shelters: PublicShelterItem[],
	lockedCode: string | null,
	pointsByShelter: Record<string, DonationMapPoint[]> = {}
): DonationMap {
	const publicByCode = new Map(shelters.map((shelter) => [codeKey(shelter.code), shelter]));
	const lockedKey = lockedCode ? codeKey(lockedCode) : null;
	const onMap: DonationMapShelter[] = [];
	const withoutGeo: DonationMapShelter[] = [];

	for (const entry of needs) {
		const key = codeKey(entry.code);
		if (lockedKey && key !== lockedKey) continue;
		const publicShelter = publicByCode.get(key);
		const geo = hasUsableGeo(publicShelter?.geo) ? publicShelter.geo : null;
		const shelter: DonationMapShelter = {
			code: entry.code,
			name: entry.name,
			siteKind: publicShelter?.site_kind ?? 'evacuation_center',
			status: publicShelter?.status ?? '',
			geo,
			areaLabel: areaLabelOf(publicShelter),
			needs: toOpenNeeds(entry),
			points: (pointsByShelter[entry.code] ?? []).filter((point) => hasUsableGeo(point.geo))
		};
		(geo ? onMap : withoutGeo).push(shelter);
	}

	return { onMap, withoutGeo };
}
