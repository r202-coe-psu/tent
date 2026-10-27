import { formatMasterLabel } from '$lib/features/master-data';
import type { MasterLabelOption } from './master-labels';

/** One `master_data:site_kind` item as served by `/api/public/v1/config/site-kinds`. */
export type SiteKindOption = MasterLabelOption & { status?: string };

export const DEFAULT_SITE_KIND = 'evacuation_center';
export const HOST_HOUSE_SITE_KIND = 'host_house';

/**
 * Labels for the two seeded codes, used only while the site-kinds list has not
 * loaded (or the BFF degraded to an empty list). A master item always wins.
 */
const SEEDED_SITE_KINDS: Record<string, SiteKindOption> = {
	[DEFAULT_SITE_KIND]: {
		code: DEFAULT_SITE_KIND,
		label_th: 'ศูนย์อพยพ',
		label_en: 'Evacuation Center'
	},
	[HOST_HOUSE_SITE_KIND]: {
		code: HOST_HOUSE_SITE_KIND,
		label_th: 'บ้านพี่เลี้ยง',
		label_en: 'Host House'
	}
};

/** A shelter without a stored `site_kind` reads as an evacuation center (CR-198 FR-6). */
export function normalizeSiteKind(code: string | null | undefined): string {
	return code?.trim() || DEFAULT_SITE_KIND;
}

/** Display label by language; a code with no label anywhere is shown as the code (CR-198 FR-16). */
export function siteKindLabel(
	code: string | null | undefined,
	kinds: readonly SiteKindOption[] | null | undefined,
	lang: string = 'th'
): string {
	const resolved = normalizeSiteKind(code);
	const item = kinds?.find((k) => k.code === resolved) ?? SEEDED_SITE_KINDS[resolved];
	return item ? formatMasterLabel(item, lang) : resolved;
}

/** Items a citizen can filter by — `inactive` kinds still label existing shelters but are not offered. */
export function activeSiteKinds(
	kinds: readonly SiteKindOption[] | null | undefined
): SiteKindOption[] {
	return (kinds ?? []).filter((k) => k.status !== 'inactive');
}

/** Only `host_house` has its own pin; every other code uses the shelter pin (CR-198 FR-17). */
export function isHostHouseKind(code: string | null | undefined): boolean {
	return normalizeSiteKind(code) === HOST_HOUSE_SITE_KIND;
}

export function countBySiteKind(
	shelters: readonly { site_kind?: string | null }[]
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const s of shelters) {
		const code = normalizeSiteKind(s.site_kind);
		counts[code] = (counts[code] ?? 0) + 1;
	}
	return counts;
}

/**
 * Stat-tile rows for `/shelters` (CR-198 D-3): master order, every active kind
 * (even at 0, so the page keeps its fixed tiles), then inactive or unknown codes
 * only when shelters actually use them.
 */
export function siteKindTiles(
	counts: Readonly<Record<string, number>>,
	kinds: readonly SiteKindOption[] | null | undefined
): { code: string; count: number }[] {
	const tiles: { code: string; count: number }[] = [];
	const listed = new Set<string>();
	for (const k of kinds ?? []) {
		listed.add(k.code);
		const count = counts[k.code] ?? 0;
		if (k.status !== 'inactive' || count > 0) tiles.push({ code: k.code, count });
	}
	for (const [code, count] of Object.entries(counts)) {
		if (!listed.has(code) && count > 0) tiles.push({ code, count });
	}
	return tiles;
}
