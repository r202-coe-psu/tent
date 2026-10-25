import { z } from 'zod';

/**
 * A stock_ledger `ref_id` (`donation:01M5…`) in words a person reads (#811).
 *
 * The referenced doc is read as untrusted data: each kind below parses only the
 * fields it labels with, so a doc of another feature can change shape without
 * breaking the ledger — it just falls back to the short ref.
 */

/** Thai name of the document kind behind each `ref_id` prefix in `REF_PREFIX_BY_REASON`. */
const REF_KIND_LABELS: Record<string, string> = {
	donation: 'ใบบริจาค',
	requisition_ticket: 'ตั๋วเบิก',
	kitchen_requisition: 'ใบเบิกครัว',
	stock_transfer: 'ใบโอนย้าย',
	meal_service: 'ใบรับจากครัว',
	distribution_log: 'บันทึกแจกจ่าย',
	distribution_batch: 'รอบแจกจ่าย',
	bulk_return_pool: 'คืนของรวม'
};

const REF_TAIL_LENGTH = 5;

/** `donation:01M5…YAKTK` → `ใบบริจาค · …YAKTK`, for a ref whose doc cannot be read. */
export function shortLedgerRef(refId: string): string {
	const sep = refId.indexOf(':');
	if (sep < 0) return refId;
	const prefix = refId.slice(0, sep);
	const id = refId.slice(sep + 1);
	const kind = REF_KIND_LABELS[prefix] ?? prefix;
	const tail = id.length > REF_TAIL_LENGTH ? `…${id.slice(-REF_TAIL_LENGTH)}` : id;
	return `${kind} · ${tail}`;
}

const text = z.string().trim().min(1);

const DOC_LABELS: Record<string, (doc: unknown) => string | null> = {
	donation: (doc) => {
		const parsed = z
			.object({ donor: z.object({ name: text }), booking_ref: text.optional() })
			.safeParse(doc);
		if (!parsed.success) return null;
		const { donor, booking_ref } = parsed.data;
		return [`ผู้บริจาค ${donor.name}`, booking_ref].filter(Boolean).join(' · ');
	},
	requisition_ticket: (doc) => {
		const parsed = z.object({ ticket_no: text }).safeParse(doc);
		return parsed.success ? `ตั๋วเบิก ${parsed.data.ticket_no}` : null;
	},
	meal_service: (doc) => {
		const parsed = z.object({ receipt_no: text }).safeParse(doc);
		return parsed.success ? `ใบรับจากครัว ${parsed.data.receipt_no}` : null;
	},
	stock_transfer: (doc) => {
		const parsed = z.object({ from_shelter: text, to_shelter: text }).safeParse(doc);
		return parsed.success
			? `โอนย้าย ${parsed.data.from_shelter} → ${parsed.data.to_shelter}`
			: null;
	}
};

/** A doc a `ref_id` points at, as `_all_docs` returns it. */
export interface LedgerRefDoc {
	_id: string;
	type: string;
}

export const isLedgerRefDoc = (d: unknown): d is LedgerRefDoc =>
	!!d &&
	typeof d === 'object' &&
	typeof (d as { _id?: unknown })._id === 'string' &&
	typeof (d as { type?: unknown }).type === 'string';

/** `ref_id` → readable label, for the docs that carry something better than their id. */
export function ledgerRefLabels(docs: readonly LedgerRefDoc[]): Map<string, string> {
	const labels = new Map<string, string>();
	for (const doc of docs) {
		const label = DOC_LABELS[doc.type]?.(doc);
		if (label) labels.set(doc._id, label);
	}
	return labels;
}
