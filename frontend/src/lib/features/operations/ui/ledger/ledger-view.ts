import { qtyGt } from '$lib/utils/qty';
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';
import { lotStorageName, type StoragePointRef } from '../../domain/lot-storage';
import { shortLedgerRef } from '../../domain/ledger-ref';
import {
	BULK_RETURN_POOL_REF_PREFIX,
	resolveAdjustReason,
	type AdjustReason,
	type LedgerReason,
	type StockLedger
} from '../../domain/operations';

/** The four movement kinds the movements tab groups ledger reasons into. */
export type LedgerGroup = 'in' | 'out' | 'adjust' | 'transfer';
export type LedgerTypeFilter = LedgerGroup | 'all';

export const LEDGER_GROUP_LABELS: Record<LedgerGroup, string> = {
	in: 'รับเข้า',
	out: 'เบิกจ่าย',
	adjust: 'ปรับยอด',
	transfer: 'โอน'
};

export const LEDGER_GROUP_BY_REASON: Record<LedgerReason, LedgerGroup> = {
	receive: 'in',
	donation: 'in',
	distribute: 'out',
	requisition: 'out',
	distribution_return: 'in',
	adjust: 'adjust',
	transfer_out: 'transfer',
	transfer_in: 'transfer'
};

export const REASON_LABELS: Record<LedgerReason, string> = {
	receive: 'รับเข้าคลัง',
	donation: 'รับบริจาค',
	distribute: 'แจกจ่าย',
	requisition: 'เบิกจ่ายโรงครัว',
	distribution_return: 'รับคืนจากการแจกจ่าย',
	adjust: 'ปรับปรุงคลัง',
	transfer_out: 'โอนย้ายออก',
	transfer_in: 'โอนย้ายเข้า'
};

/** CR-143 §C — why a stock correction was made. Thai labels shared by the adjust form and the ledger. */
export const ADJUST_REASON_LABELS: Record<AdjustReason, string> = {
	expired: 'หมดอายุ',
	damaged: 'เสียหาย / เน่าเสีย',
	count_mismatch: 'นับไม่ตรง',
	lost: 'สูญหาย',
	found: 'พบของเพิ่ม',
	merge: 'รวมสินค้า',
	other: 'อื่น ๆ'
};

export type LedgerReasonFilter = AdjustReason | 'all';

/** A ledger entry flattened to what the movements tab shows and exports. */
export interface LedgerRow {
	id: string;
	occurredAt: string;
	/** Local calendar day, `YYYY-MM-DD`. */
	dayKey: string;
	/** Local time, `HH:mm`. */
	time: string;
	group: LedgerGroup;
	reason: LedgerReason;
	reasonLabel: string;
	/** Adjust rows only; a row from before schema_v 6 reads as `other` (FR-C4). */
	adjustReason: AdjustReason | null;
	adjustReasonLabel: string;
	itemName: string;
	/** Signed quantity string, exactly as persisted. */
	qty: string;
	unit: string;
	/** Adjust reason, destination (distribute / requisition) or the originating document's label. */
	detail: string;
	lotNo: string;
	storage: string;
	createdBy: string;
	refId: string;
	/** Deep link to the source document, when one exists (bulk return pool receives). */
	refHref?: BulkReturnPoolLedgerHref;
}

/** Deep link to a bulk return pool in the distribution back-office. */
export type BulkReturnPoolLedgerHref = `/back-office/distribution?view=bulk_pools&pool=${string}`;

/**
 * Link target for a ledger `ref_id` that points at a bulk return pool, else `undefined`.
 * Receive-only: the `reason` gate is a render-side guard that mirrors `REF_PREFIX_BY_REASON.receive`
 * (CR-193 §29), the write-side rule that allows this prefix for `receive` only.
 * Mirrors `bulkReturnPoolHref` of the distribution feature; inlined here because this module is
 * pure and must not import the distribution barrel (UI components, import cycle risk).
 */
export function ledgerRefHref(
	reason: LedgerReason,
	refId: string | null | undefined
): BulkReturnPoolLedgerHref | undefined {
	if (reason !== 'receive') return undefined;
	if (!refId || !refId.startsWith(BULK_RETURN_POOL_REF_PREFIX)) return undefined;
	const poolId = refId.slice(BULK_RETURN_POOL_REF_PREFIX.length);
	if (!poolId) return undefined;
	return `/back-office/distribution?view=bulk_pools&pool=${encodeURIComponent(poolId)}`;
}

/** Name resolvers the row builder needs; kept as functions so this module stays pure. */
export interface LedgerLookup {
	itemName: (itemId: string) => string;
	unitLabel: (unit: string) => string;
	points: readonly StoragePointRef[];
	/** Readable label of the doc a `ref_id` points at; unknown refs show `shortLedgerRef`. */
	refLabel?: (refId: string) => string | undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a Date in local time. */
export function toDayKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local `HH:mm`. */
export function toTime(date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toLedgerRow(entry: StockLedger, lookup: LedgerLookup): LedgerRow {
	const group = LEDGER_GROUP_BY_REASON[entry.reason];
	const date = new Date(entry.occurred_at);
	const valid = !Number.isNaN(date.getTime());
	// A distribute/requisition row keeps its destination in `lot.note`, which
	// `lotStorageName` would otherwise read as a legacy location.
	const isOut = group === 'out';
	const destination = isOut ? (entry.lot?.note?.trim() ?? '') : '';
	const adjustReason = resolveAdjustReason(entry);
	const adjustReasonLabel = adjustReason ? ADJUST_REASON_LABELS[adjustReason] : '';
	const adjustDetail = adjustReason
		? [adjustReasonLabel, entry.note?.trim()].filter(Boolean).join(' · ')
		: '';
	const lot = entry.lot && isOut ? { ...entry.lot, note: undefined } : entry.lot;
	const refDetail = entry.ref_id
		? (lookup.refLabel?.(entry.ref_id) ?? shortLedgerRef(entry.ref_id))
		: '';
	// Adjust / destination text replaces the ref text as the row detail, so it wins over the ref link.
	const refHref =
		adjustDetail || destination ? undefined : ledgerRefHref(entry.reason, entry.ref_id);
	return {
		id: entry._id,
		occurredAt: entry.occurred_at,
		dayKey: valid ? toDayKey(date) : '',
		time: valid ? toTime(date) : '',
		group,
		reason: entry.reason,
		reasonLabel: REASON_LABELS[entry.reason] ?? entry.reason,
		adjustReason,
		adjustReasonLabel,
		itemName: lookup.itemName(entry.item_id),
		qty: entry.qty,
		unit: lookup.unitLabel(entry.unit),
		detail: adjustDetail || destination || refDetail,
		lotNo: entry.lot?.lot_no ?? '',
		storage: lotStorageName(lot, lookup.points) ?? '',
		createdBy: entry.created_by,
		refId: entry.ref_id ?? '',
		...(refHref ? { refHref } : {})
	};
}

/** Newest first; ties fall back to the id so the order is stable. */
export function buildLedgerRows(
	entries: readonly StockLedger[],
	lookup: LedgerLookup
): LedgerRow[] {
	return entries
		.map((e) => toLedgerRow(e, lookup))
		.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
}

/** Inclusive local-day bounds; `null` = open on that side. */
export interface DayRange {
	from: string | null;
	to: string | null;
}

export function filterByRange(rows: readonly LedgerRow[], range: DayRange): LedgerRow[] {
	return rows.filter(
		(r) => (!range.from || r.dayKey >= range.from) && (!range.to || r.dayKey <= range.to)
	);
}

export interface LedgerFilter {
	range: DayRange;
	type: LedgerTypeFilter;
	q: string;
	/** Adjust reason (FR-C5); omitted / `all` keeps every row. */
	reason?: LedgerReasonFilter;
}

/** Range, type and free-text search (item, reference, destination, lot, place, author). */
export function filterLedger(rows: readonly LedgerRow[], filter: LedgerFilter): LedgerRow[] {
	const q = filter.q.trim().toLowerCase();
	return filterByRange(rows, filter.range).filter((r) => {
		if (filter.type !== 'all' && r.group !== filter.type) return false;
		if (filter.reason && filter.reason !== 'all' && r.adjustReason !== filter.reason) return false;
		if (!q) return true;
		return [r.itemName, r.refId, r.detail, r.lotNo, r.storage, r.createdBy].some((v) =>
			v.toLowerCase().includes(q)
		);
	});
}

export interface LedgerDayGroup {
	dayKey: string;
	rows: LedgerRow[];
}

/** Group rows (already newest-first) by local day, keeping their order. */
export function groupByDay(rows: readonly LedgerRow[]): LedgerDayGroup[] {
	const groups: LedgerDayGroup[] = [];
	for (const row of rows) {
		const last = groups[groups.length - 1];
		if (last && last.dayKey === row.dayKey) last.rows.push(row);
		else groups.push({ dayKey: row.dayKey, rows: [row] });
	}
	return groups;
}

export interface DaySummaryCard {
	group: LedgerGroup;
	label: string;
	count: number;
	hint: string;
}

/** The four summary cards for a set of rows; hints use only what the ledger itself holds. */
export function summarizeRows(rows: readonly LedgerRow[]): DaySummaryCard[] {
	const of = (g: LedgerGroup) => rows.filter((r) => r.group === g);
	const inRows = of('in');
	const outRows = of('out');
	const adjustRows = of('adjust');
	const transferRows = of('transfer');

	const sources = new Set(
		inRows.filter((r) => r.reason === 'donation' && r.refId).map((r) => r.refId)
	);
	const kitchen = outRows.filter((r) => r.reason === 'requisition').length;
	const written = adjustRows.filter((r) => !qtyGt(r.qty, 0)).length;
	const sent = transferRows.filter((r) => r.reason === 'transfer_out').length;
	const received = transferRows.filter((r) => r.reason === 'transfer_in').length;

	return [
		{
			group: 'in',
			label: LEDGER_GROUP_LABELS.in,
			count: inRows.length,
			hint: sources.size > 0 ? `รายการ · จาก ${sources.size} ใบบริจาค` : 'รายการ'
		},
		{
			group: 'out',
			label: LEDGER_GROUP_LABELS.out,
			count: outRows.length,
			hint: kitchen > 0 ? `รายการ · ครัวกลาง ${kitchen}` : 'รายการ'
		},
		{
			group: 'adjust',
			label: LEDGER_GROUP_LABELS.adjust,
			count: adjustRows.length,
			hint: written > 0 ? `รายการ · ตัดออก ${written}` : 'รายการ'
		},
		{
			group: 'transfer',
			label: 'โอนย้าย',
			count: transferRows.length,
			hint: `ส่งออก ${sent} · รับเข้า ${received}`
		}
	];
}

export const LEDGER_CSV_HEADER = [
	'วันที่',
	'เวลา',
	'ประเภท',
	'รายการ',
	'จำนวน',
	'หน่วย',
	'ที่มา/ปลายทาง/เหตุผล',
	'ล็อต',
	'จุดเก็บ',
	'ผู้บันทึก',
	'เลขอ้างอิง'
] as const;

function csvCell(value: string): string {
	// A leading = + - @ would run as a formula in Excel; a signed qty ("-20") is
	// a number, so only prefix cells that are not plain numbers.
	const risky = /^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value);
	return `"${(risky ? `'${value}` : value).replace(/"/g, '""')}"`;
}

/**
 * RFC 4180 CSV (CRLF) of the given rows. No BOM here — the download step adds it so
 * Excel reads the Thai text as UTF-8.
 */
export function ledgerToCsv(rows: readonly LedgerRow[]): string {
	const lines = rows.map((r) =>
		[
			r.dayKey,
			r.time,
			r.reasonLabel,
			r.itemName,
			r.qty,
			r.unit,
			r.detail,
			r.lotNo,
			r.storage,
			r.createdBy,
			r.refId
		]
			.map(csvCell)
			.join(',')
	);
	return [LEDGER_CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n');
}

/** Heading of a day group: "วันนี้ · วันพฤหัสบดีที่ 2 ต.ค. 2569". */
export function dayHeading(dayKey: string, now: Date = new Date()): string {
	if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return 'ไม่ทราบวันที่';
	// Noon Bangkok keeps the calendar day stable regardless of the machine TZ.
	const date = new Date(`${dayKey}T12:00:00+07:00`);
	if (Number.isNaN(date.getTime())) return 'ไม่ทราบวันที่';
	const full = date.toLocaleDateString(DISPLAY_LOCALE, {
		timeZone: DISPLAY_TIME_ZONE,
		weekday: 'long',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (dayKey === toDayKey(now)) return `วันนี้ · ${full}`;
	if (dayKey === toDayKey(yesterday)) return `เมื่อวาน · ${full}`;
	return full;
}
