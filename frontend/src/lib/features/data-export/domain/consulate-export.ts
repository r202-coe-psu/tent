import {
	EVACUEE_SEARCH_I18N,
	stayZoneName,
	type Evacuee,
	type StayStatus,
	type ZoneLabelSource
} from '$lib/features/people';
import {
	CARD_TYPE_CHOICES,
	GENDER_CHOICES,
	H,
	RELIGION_CHOICES,
	type EnumChoice
} from '$lib/features/people-import';

/**
 * Consulate export (CR-232 section B, issue #1206) — pure row building.
 *
 * Decides WHO is in the file (FR-20..22), WHICH columns and in what order
 * (FR-30..31) and the row order (FR-32). No I/O, no Svelte: the data layer reads
 * evacuees, the application layer audits and downloads.
 */

/** FR-20 — stay statuses that appear in the file. */
export const CONSULATE_EXPORT_STATUSES: readonly StayStatus[] = [
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave',
	'transferred',
	'checked_out',
	'deceased'
];

/** Country value that is never offered to a consulate (FR-12). */
export const DOMESTIC_COUNTRY = 'THAILAND';

/** FR-13 — the single sheet's name. */
export const CONSULATE_SHEET_NAME = 'รายชื่อผู้ประสบภัย';

/** FR-40 — `audit.reason` for every consulate export. */
export const CONSULATE_AUDIT_REASON = 'consulate_export';

/** Same normalisation as the `demographics_by_country` view: trim + uppercase. */
export function normalizeCountry(country: string | null | undefined): string {
	return (country ?? '').trim().toUpperCase();
}

/** FR-20 + FR-21 — status in the exportable set and the doc not anonymized. */
export function isConsulateExportable(e: Evacuee): boolean {
	if (e.anonymized === true) return false;
	const status = e.current_stay?.status;
	return !!status && CONSULATE_EXPORT_STATUSES.includes(status);
}

export interface ExportCountry {
	/** Normalised (trim + uppercase) country code, e.g. `MYANMAR`. */
	country: string;
	count: number;
}

/**
 * FR-12 — countries offered in the dialog: not THAILAND, not blank, only people who
 * are exportable, with their head count. Sorted by count desc then code.
 */
export function listExportCountries(evacuees: readonly Evacuee[]): ExportCountry[] {
	const counts = new Map<string, number>();
	for (const e of evacuees) {
		if (!isConsulateExportable(e)) continue;
		const country = normalizeCountry(e.country);
		if (!country || country === DOMESTIC_COUNTRY) continue;
		counts.set(country, (counts.get(country) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([country, count]) => ({ country, count }))
		.sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

/** FR-20..22 — people for one country (FR-22: search_excluded / consent basic stay in). */
export function selectConsulateEvacuees(evacuees: readonly Evacuee[], country: string): Evacuee[] {
	const wanted = normalizeCountry(country);
	// Defence in depth: the dialog never offers THAILAND (FR-12), so the builder refuses it too.
	if (!wanted || wanted === DOMESTIC_COUNTRY) return [];
	return evacuees.filter((e) => isConsulateExportable(e) && normalizeCountry(e.country) === wanted);
}

// ---------------------------------------------------------------- columns (FR-30)

export const CONSULATE_HEADERS = [
	'ลำดับ',
	H.first_name,
	H.last_name,
	H.gender,
	H.birth_year,
	H.age,
	H.country,
	H.card_type,
	'เลขบัตร/passport',
	'เบอร์โทร',
	'สถานะการพัก',
	'วันที่เริ่มสถานะ',
	'โซน',
	H.emergency_name,
	H.emergency_phone,
	H.emergency_relation,
	H.religion,
	'กลุ่มเปราะบาง',
	'special needs'
] as const;

/** Zero-based indexes of columns that must stay text in Excel (ids, phones). */
export const CONSULATE_TEXT_COLUMNS: readonly number[] = [8, 9, 14];

export type CellValue = string | number | null;

export interface ConsulateLookups {
	/** Items of master `vulnerable_group` (code → label). */
	vulnerableGroups?: readonly { code: string; label_th?: string; label_en?: string }[];
	/** Shelter zones, for the zone name. */
	zones?: readonly ZoneLabelSource[];
}

function choiceLabel<T extends string>(
	choices: readonly EnumChoice<T>[],
	value: string | null | undefined
): string | null {
	if (!value) return null;
	return choices.find((c) => c.value === value)?.label ?? null;
}

function statusLabel(status: StayStatus): string {
	const th = EVACUEE_SEARCH_I18N.th.statusLabels[status];
	const en = EVACUEE_SEARCH_I18N.en.statusLabels[status];
	return th && en ? `${th} (${en})` : (th ?? en ?? status);
}

/** `YYYY-MM-DD HH:mm` in +07 (Asia/Bangkok has no DST); `null` when unparseable. */
export function formatBangkokDateTime(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) return null;
	return new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** `YYYYMMDD-HHmm` in +07 (FR-5, FR-13). */
export function bangkokFileStamp(now: Date): string {
	const s = formatBangkokDateTime(now.toISOString()) ?? '';
	return s.replace(/-/g, '').replace(' ', '-').replace(':', '');
}

/** FR-13 — `consulate-{shelter_code}-{country}-{YYYYMMDD-HHmm}.xlsx`. */
export function consulateFileName(shelterCode: string, country: string, now: Date): string {
	const safe = (v: string) => v.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_');
	return `consulate-${safe(shelterCode)}-${safe(country)}-${bangkokFileStamp(now)}.xlsx`;
}

function religionCell(e: Evacuee): string | null {
	if (!e.religion) return null;
	if (e.religion === 'other') {
		const detail = e.religion_other?.trim();
		if (detail) return detail;
	}
	return choiceLabel(RELIGION_CHOICES, e.religion) ?? e.religion;
}

function vulnerableCell(e: Evacuee, lookups: ConsulateLookups): string | null {
	const labels = (e.vulnerable_groups ?? []).map((code) => {
		const item = lookups.vulnerableGroups?.find((i) => i.code === code);
		return item?.label_th?.trim() || item?.label_en?.trim() || code;
	});
	const detail = e.disability_other_detail?.trim();
	if (detail) labels.push(detail);
	return labels.length ? labels.join(',') : null;
}

function compareName(a: Evacuee, b: Evacuee): number {
	return (
		a.first_name.localeCompare(b.first_name, 'th') ||
		a.last_name.localeCompare(b.last_name, 'th') ||
		a._id.localeCompare(b._id)
	);
}

export interface ConsulateTable {
	headers: readonly string[];
	rows: CellValue[][];
}

/**
 * S1 — filter (FR-20..22), sort (FR-32) and map to cells (FR-30/30a/31). Values the
 * evacuee does not have stay `null` (empty cell); birth year and age are never derived
 * from each other.
 */
export function buildConsulateRows(
	evacuees: readonly Evacuee[],
	country: string,
	lookups: ConsulateLookups = {}
): ConsulateTable {
	const people = selectConsulateEvacuees(evacuees, country).sort(compareName);
	const rows = people.map((e, i): CellValue[] => {
		const anonymous = e.person_id?.cardType === 'anonymous';
		const stay = e.current_stay;
		const ec = e.emergency_contact;
		return [
			i + 1,
			e.first_name || null,
			e.last_name || null,
			choiceLabel(GENDER_CHOICES, e.gender),
			typeof e.birth_year === 'number' ? e.birth_year : null,
			typeof e.age === 'number' ? e.age : null,
			normalizeCountry(e.country) || null,
			anonymous ? null : choiceLabel(CARD_TYPE_CHOICES, e.person_id?.cardType),
			anonymous ? null : e.person_id?.number?.trim() || null,
			e.phone?.trim() || null,
			statusLabel(stay.status),
			formatBangkokDateTime(stay.since),
			stayZoneName(stay.zone, lookups.zones),
			ec?.name?.trim() || null,
			ec?.phone?.trim() || null,
			ec?.relation?.trim() || null,
			religionCell(e),
			vulnerableCell(e, lookups),
			e.special_needs?.length ? e.special_needs.join(',') : null
		];
	});
	return { headers: CONSULATE_HEADERS, rows };
}
