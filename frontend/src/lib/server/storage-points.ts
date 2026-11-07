import { z } from 'zod';
import { ulid } from '$lib/db/ulid';
import { canManageStoragePoints } from '$lib/auth/roles';
import { countLotsHoldingStock, projectLotsByItem } from '$lib/features/operations/server';
import type { StockLedger } from '$lib/features/operations/server';
import {
	subStorageItemSchema,
	type ShelterMaster,
	type SubStorageItem
} from '$lib/features/shelters/server';
import { adminRaw, authorizeSession, ServiceError, type Caller } from './couch-admin';
import { shelterDbName } from './shelter-access-design';
import { findMasterByCode, migrate, nowIso, updateMaster } from './shelters.admin';

/** Rows per `_find` page when the ledger is read in full; the same page size the ledger screens use. */
const LEDGER_PAGE_LIMIT = 1000;

/** `_rev` the client read, plus the point's fields. Anything else in the body is ignored. */
export const storagePointBodySchema = z.object({
	_rev: z.string().min(1, 'ต้องระบุ _rev'),
	point: z.unknown()
});

export const storagePointDeleteBodySchema = z.object({ _rev: z.string().min(1, 'ต้องระบุ _rev') });

/** Turn a zod failure into the contract's 422 with the first Thai message. */
export function validationError(e: unknown): unknown {
	return e instanceof z.ZodError
		? new ServiceError('VALIDATION', e.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
		: e;
}

/**
 * Gate for the storage-point endpoints (#1186): SA, or SM / warehouse_staff of
 * the shelter in the URL. The shelter code comes from the path and is checked against the session's
 * roles, never taken from the body.
 */
export async function requireStoragePointManager(
	cookie: string | null,
	code: string
): Promise<Caller> {
	const caller = await authorizeSession(cookie);
	if (!canManageStoragePoints(caller.roles, code)) {
		throw new ServiceError('FORBIDDEN', `Caller may not manage storage points of "${code}"`);
	}
	return caller;
}

/** The shelter's storage points and the `_rev` a following write must quote. */
export async function readStoragePoints(
	code: string
): Promise<{ rev: string; points: SubStorageItem[] }> {
	const master = await findMasterByCode(code);
	if (!master) throw new ServiceError('NOT_FOUND', `Shelter "${code}" not found`);
	const migrated = migrate(master);
	return { rev: master._rev ?? '', points: migrated.common_areas?.sub_storage ?? [] };
}

/** Every doc matching `selector`, read page by page with CouchDB's bookmark — no overall cap. */
async function findAll<T>(db: string, selector: object, fields?: string[]): Promise<T[]> {
	const docs: T[] = [];
	let bookmark: string | undefined;
	for (;;) {
		const res = await adminRaw(`/${db}/_find`, 'POST', {
			selector,
			...(fields ? { fields } : {}),
			limit: LEDGER_PAGE_LIMIT,
			...(bookmark ? { bookmark } : {})
		});
		if (res.status >= 400) {
			throw new ServiceError('INTERNAL', 'Could not check stock at the storage point');
		}
		const page = res.data as { docs?: T[]; bookmark?: string } | null;
		const pageDocs = page?.docs ?? [];
		docs.push(...pageDocs);
		// A short page is the end; a bookmark that does not move would loop forever.
		if (pageDocs.length < LEDGER_PAGE_LIMIT || !page?.bookmark || page.bookmark === bookmark) {
			return docs;
		}
		bookmark = page.bookmark;
	}
}

/**
 * Lots at storage point `pointId` that still hold stock. Reads the ledger rows that name the point,
 * then every row of each of those items (a lot's outbound rows do not carry its location) and
 * projects the lot balances. Both reads page through the whole ledger, so a big history is only
 * slower, never cut short. A ledger that cannot be projected or read fails closed — the point is
 * not deletable until the history is sorted out.
 */
export async function countStockedLots(code: string, pointId: string): Promise<number> {
	const db = shelterDbName(code);
	// `item_id` is in the selector only so CouchDB picks `ledger-type-itemid-idx`.
	const atPoint = await findAll<{ item_id: string }>(
		db,
		{ type: 'stock_ledger', item_id: { $gt: null }, 'lot.storage_point_id': pointId },
		['item_id']
	);
	const itemIds = [...new Set(atPoint.map((d) => d.item_id))];
	if (itemIds.length === 0) return 0;

	// One equality read per item: an `$in` cannot range-scan `ledger-type-itemid-idx` and would
	// read every `stock_ledger` row instead.
	const perItem = await Promise.all(
		itemIds.map((itemId) => findAll<StockLedger>(db, { type: 'stock_ledger', item_id: itemId }))
	);
	const { lots, brokenItemIds } = projectLotsByItem(perItem.flat());
	if (brokenItemIds.length > 0) {
		throw new ServiceError(
			'CONFLICT',
			'ประวัติสต็อกของบางรายการไม่สอดคล้องกัน จึงลบจุดเก็บของนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'
		);
	}
	return countLotsHoldingStock(pointId, lots);
}

type PointMutation = (points: readonly SubStorageItem[]) => Promise<SubStorageItem[]>;

/**
 * Write only `common_areas.sub_storage`. `rev` is the `_rev` the client read: a stale one (the
 * shelter form or another user saved meanwhile) is a 409, never a silent merge. `updateMaster`
 * re-runs the mutator against the freshly read doc when its own write conflicts, so the check holds
 * on every retry.
 */
async function mutateStoragePoints(
	code: string,
	rev: string,
	mutate: PointMutation
): Promise<{ rev: string }> {
	const result = await updateMaster(code, async (current: ShelterMaster) => {
		if (!rev || current._rev !== rev) {
			throw new ServiceError(
				'CONFLICT',
				'ข้อมูลศูนย์ถูกแก้ไขโดยผู้อื่น กรุณาโหลดใหม่แล้วลองอีกครั้ง'
			);
		}
		const next = await mutate(current.common_areas?.sub_storage ?? []);
		return {
			patch: {
				common_areas: { ...current.common_areas, sub_storage: next },
				updated_at: nowIso()
			}
		};
	});
	return { rev: result.rev };
}

/** The point's fields, validated with the shelter form's schema; `id` is always the server's. */
function parsePoint(raw: unknown, id: string): SubStorageItem {
	const input = raw !== null && typeof raw === 'object' ? raw : {};
	return subStorageItemSchema.parse({ ...input, id }) as SubStorageItem;
}

export async function addStoragePoint(
	code: string,
	rev: string,
	raw: unknown
): Promise<{ rev: string; point: SubStorageItem }> {
	const point = parsePoint(raw, ulid());
	const written = await mutateStoragePoints(code, rev, async (points) => [...points, point]);
	return { ...written, point };
}

export async function editStoragePoint(
	code: string,
	pointId: string,
	rev: string,
	raw: unknown
): Promise<{ rev: string; point: SubStorageItem }> {
	const point = parsePoint(raw, pointId);
	const written = await mutateStoragePoints(code, rev, async (points) => {
		if (!points.some((p) => p.id === pointId)) throw pointNotFound(pointId);
		return points.map((p) => (p.id === pointId ? point : p));
	});
	return { ...written, point };
}

export async function removeStoragePoint(
	code: string,
	pointId: string,
	rev: string
): Promise<{ rev: string }> {
	return mutateStoragePoints(code, rev, async (points) => {
		if (!points.some((p) => p.id === pointId)) throw pointNotFound(pointId);
		const stocked = await countStockedLots(code, pointId);
		if (stocked > 0) {
			throw new ServiceError(
				'CONFLICT',
				`ยังมีของคงเหลือ ${stocked} ล็อตที่จุดเก็บของนี้ กรุณาย้ายของออกก่อนลบ`
			);
		}
		return points.filter((p) => p.id !== pointId);
	});
}

function pointNotFound(pointId: string): ServiceError {
	return new ServiceError('NOT_FOUND', `Storage point "${pointId}" not found`);
}
