import { z } from 'zod';
import { ulid } from '$lib/db/ulid';

/**
 * Master Data Engine — central-managed parameter lists for personal data forms
 * (docs/changes/CR-010-master-data-engine.md).
 *
 * Pure / isomorphic: no PouchDB, no Svelte. UI reads from the server BFF; the
 * factory here is the single source of truth for `master_data` documents stored
 * in the `registry` CouchDB. Each registry doc has `_id = "master_data:{type}"`
 * (1 doc per type, deterministic — exception to the `{type}:{ulid}` convention
 * because 1:1 with `master_type`).
 *
 * Phase 1: CRUD only — no wire to evacuee/medical/household forms. Phase 2
 * (separate CR) will replace hardcoded enums in those forms with a master
 * lookup; the `code` field here is the public-facing stable value that will
 * be saved on the main doc (e.g. `evacuee.special_needs = ["elderly"]`).
 */

// ---------------------------------------------------------------- master types

export const MASTER_DATA_TYPES = [
	'vulnerable_group',
	'health_condition',
	'dietary_restrictions',
	'pet_types',
	'house_damage',
	'municipality_zone',
	'community',
	'shelter_type'
] as const;
export type MasterDataType = (typeof MASTER_DATA_TYPES)[number];

export const masterTypeSchema = z.enum(MASTER_DATA_TYPES);

/** Where a master-data document is resolved from. */
export const masterDataScopeSchema = z.enum(['global', 'shelter', 'effective']);
export type MasterDataScope = z.infer<typeof masterDataScopeSchema>;

export interface MasterDataQueryContext {
	scope?: MasterDataScope;
	shelterCode?: string | null;
}

export type MasterDataRecordScope = 'global' | 'shelter';

export interface MasterDataItemSource {
	scope: MasterDataRecordScope;
	shelter_code?: string | null;
	/** For a global item under a shelter context: true when the current shelter
	 *  has disabled it locally (`disabled_global_codes`) — global doc unchanged. */
	shelter_disabled?: boolean;
}

/** Types shown on the Registration Config page (ตั้งค่าการลงทะเบียน). */
export const REGISTRATION_MASTER_TYPES = [
	'vulnerable_group',
	'health_condition',
	'dietary_restrictions',
	'pet_types',
	'house_damage'
] as const satisfies readonly MasterDataType[];

/** Types shown on the Household Master Data page. */
export const HOUSEHOLD_MASTER_TYPES = [
	'municipality_zone',
	'community'
] as const satisfies readonly MasterDataType[];

/** Types shown on the Shelter Config page. */
export const SHELTER_MASTER_TYPES = ['shelter_type'] as const satisfies readonly MasterDataType[];

/** Thai + English labels for the master_type enum — used in the type list cards. */
export const MASTER_DATA_TYPE_LABELS: Record<MasterDataType, string> = {
	vulnerable_group: 'ประเภทกลุ่มเปราะบาง (Vulnerable Group)',
	health_condition: 'โรคประจำตัวและอาการแพ้ (Health Condition)',
	dietary_restrictions: 'ศาสนาและข้อจำกัดอาหาร (Dietary Restrictions)',
	pet_types: 'ประเภทสัตว์เลี้ยง (Pet Types)',
	house_damage: 'สถานะความเสียหายของบ้าน (House Damage)',
	municipality_zone: 'เขตเทศบาล (Municipality Zone)',
	community: 'ชุมชน (Community)',
	shelter_type: 'ประเภทศูนย์พักพิง (Shelter Type)'
};

/** Stable id: global docs use `master_data:{type}`, local docs append the shelter code. */
export function masterDocId(type: MasterDataType, shelterCode?: string | null): string {
	return shelterCode ? `master_data:${type}:${shelterCode}` : `master_data:${type}`;
}

// ---------------------------------------------------------------- items

export const itemInputSchema = z.object({
	label: z.string().trim().min(1, 'Label is required'),
	is_default: z.boolean().default(false)
});
export type ItemInput = z.input<typeof itemInputSchema>;

export const masterDataItemSchema = z.object({
	code: z
		.string()
		.trim()
		.min(1)
		.regex(/^[a-z0-9_]+$/, 'Code must be lower_snake'),
	label: z.string().trim().min(1),
	is_default: z.boolean(),
	status: z.enum(['active', 'inactive']).default('active'),
	parent_code: z.string().trim().min(1).optional()
});
export type MasterDataItem = z.infer<typeof masterDataItemSchema>;

// ---------------------------------------------------------------- unique label

/** Invisible characters that carry no meaning in a label but break a naive
 *  comparison. JS `\s` covers NBSP and U+FEFF but NOT the zero-width family
 *  (U+200B–U+200D, category Cf) — and U+200B is common in Thai text pasted out
 *  of Word/Excel/LINE, where it is used as a word separator. */
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * Normalize a label for duplicate detection (CR-078): NFC-normalize (Thai
 * combining marks), drop zero-width characters, trim, collapse every run of
 * whitespace (incl. NBSP) to a single space, and lowercase. Thai is caseless —
 * lowercasing only affects the Latin part of a label such as
 * `"ผู้สูงอายุ (Elderly)"`.
 *
 * Comparison-only: the stored `label` keeps the operator's exact spelling.
 */
export function normalizeLabel(label: string): string {
	return label
		.normalize('NFC')
		.replace(INVISIBLE_CHARS, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * First item in `items` whose label collides with `label`, or `undefined`
 * (CR-078). `excludeCode` skips the item being edited so re-saving an item
 * without renaming it is allowed.
 *
 * **Inactive items count.** A deprecated label stays resolvable for records
 * that already reference its `code` (soft-delete, schema.md §3.3), so reusing
 * the same text on a new item would make those two indistinguishable in the UI.
 */
export function findDuplicateLabel(
	items: readonly MasterDataItem[],
	label: string,
	excludeCode?: string
): MasterDataItem | undefined {
	const target = normalizeLabel(label);
	if (!target) return undefined;
	return items.find((i) => i.code !== excludeCode && normalizeLabel(i.label) === target);
}

/**
 * Drop items whose `code` repeats, keeping the first occurrence (CR-078).
 *
 * `code` is the identity of an item everywhere in this feature: `applyItemOp`
 * matches on it, `mergeMasterDataItems` builds `item_sources` keyed by it, and
 * consumers resolve a saved value with `find(code)`. A repeated code therefore
 * is not "two items" — it is one item recorded twice, and it makes the list
 * unfixable from the UI (editing or toggling either row hits both).
 *
 * Defensive repair on the write path, same spirit as {@link enforceOneDefault}:
 * the next save of that type collapses the copies. Keeping the FIRST occurrence
 * is the only safe choice — it is the one already referenced by existing records.
 */
export function dedupeItemsByCode(items: readonly MasterDataItem[]): MasterDataItem[] {
	const seen = new Set<string>();
	const out: MasterDataItem[] = [];
	for (const item of items) {
		if (seen.has(item.code)) continue;
		seen.add(item.code);
		out.push(item);
	}
	return out;
}

/**
 * Codes that appear more than once in `items` (CR-078) — the read-side
 * counterpart of {@link dedupeItemsByCode}, used to flag the affected rows and
 * to keep a keyed `{#each}` from throwing on the duplicate key.
 */
export function duplicateItemCodes(items: readonly MasterDataItem[]): Set<string> {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const item of items) {
		if (seen.has(item.code)) repeated.add(item.code);
		seen.add(item.code);
	}
	return repeated;
}

/**
 * Normalized labels that ALREADY appear more than once across `itemGroups`
 * (CR-078). The write path passes the currently persisted state so those labels
 * are grandfathered: data that predates this rule must not brick every later
 * edit of that type — a status toggle or an unrelated rename would otherwise be
 * rejected forever with no way to reach the offending item.
 */
export function duplicateLabelKeys(
	...itemGroups: readonly (readonly MasterDataItem[])[]
): Set<string> {
	const seen = new Set<string>();
	const duplicated = new Set<string>();
	for (const group of itemGroups) {
		for (const item of group) {
			const key = normalizeLabel(item.label);
			if (seen.has(key)) duplicated.add(key);
			seen.add(key);
		}
	}
	return duplicated;
}

/**
 * Whole-list guard for the write path (CR-078): the first label that collides
 * either inside `items` itself or with `against`, or `undefined` when clean.
 *
 * `against` carries the items of the OTHER tier — global items when validating
 * a shelter-local write, and every shelter-local item when validating a global
 * write. The check is symmetric because the shelter UI renders the merged
 * global + local list, so a collision from either direction produces two rows
 * that read identically.
 *
 * `grandfathered` (see {@link duplicateLabelKeys}) holds normalized labels that
 * already collided before this write; those are skipped so pre-existing data
 * never blocks an unrelated edit. Returns the label as stored (not normalized)
 * so the message can quote what the operator sees.
 */
export function findLabelCollision(
	items: readonly MasterDataItem[],
	against: readonly MasterDataItem[] = [],
	grandfathered: ReadonlySet<string> = new Set()
): string | undefined {
	const seen = new Set(against.map((i) => normalizeLabel(i.label)));
	for (const item of items) {
		const key = normalizeLabel(item.label);
		if (seen.has(key) && !grandfathered.has(key)) return item.label;
		seen.add(key);
	}
	return undefined;
}

// ---------------------------------------------------------------- document

/** Author context for a registry doc. Global docs omit `shelter_code`. */
export interface RegistryAuthorContext {
	createdBy: string;
}

export interface MasterData {
	_id: string;
	_rev?: string;
	type: 'master_data';
	schema_v: 1 | 2 | 3;
	master_type: MasterDataType;
	shelter_code?: string;
	items: MasterDataItem[];
	/** Shelter-local only: ULID codes of GLOBAL items this shelter has disabled
	 *  (per-shelter deactivate; global doc untouched). Absent = none. */
	disabled_global_codes?: string[];
	/** Shelter-local only: code of a GLOBAL item this shelter has chosen as its
	 *  default (CR-049 amendment). The global item's `label`/`is_default` are
	 *  never mutated — this is a per-shelter pointer only. Absent = fall back
	 *  to the global item flagged `is_default`. */
	default_global_code?: string;
	created_at: string;
	updated_at: string;
	created_by: string;
}

export const masterDataSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('master_data'),
	schema_v: z.union([z.literal(1), z.literal(2), z.literal(3)]),
	master_type: masterTypeSchema,
	shelter_code: z.string().trim().min(1).optional(),
	items: z.array(masterDataItemSchema).min(0),
	disabled_global_codes: z.array(z.string().trim().min(1)).optional(),
	default_global_code: z.string().trim().min(1).optional(),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
});

export const isMasterData = (d: unknown): d is MasterData =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'master_data';

// ---------------------------------------------------------------- migration v2 → v3

/** A pre-v3 master_data doc: items may lack `status`, the doc may carry the
 *  now-removed `excluded_codes`, and `schema_v` may be 1 or 2. */
type LegacyMasterItem = Omit<MasterDataItem, 'status'> & { status?: MasterDataItem['status'] };
type LegacyMasterData = Omit<MasterData, 'schema_v' | 'items'> & {
	schema_v?: number;
	items?: LegacyMasterItem[];
	excluded_codes?: string[];
};

/** True when a doc still needs the v3 shape: schema_v < 3, a leftover
 *  `excluded_codes`, or any item missing `status`. Idempotent gate for the
 *  migration runner (see scripts/migrate-master-data.ts). */
export function needsMasterDataMigration(doc: LegacyMasterData): boolean {
	if ((doc.schema_v ?? 0) < 3) return true;
	if ('excluded_codes' in doc && doc.excluded_codes !== undefined) return true;
	return (doc.items ?? []).some((i) => i.status === undefined);
}

/** Migrate a master_data doc to schema_v 3 (CR-049): backfill item `status`
 *  (default `active`), drop `excluded_codes`, stamp `schema_v: 3`. Pure — no
 *  I/O, no clock. The runner writes the result back and stamps `updated_at`. */
export function migrateMasterDataToV3(doc: LegacyMasterData): MasterData {
	const items: MasterDataItem[] = (doc.items ?? []).map((i) => ({
		code: i.code,
		label: i.label,
		is_default: i.is_default,
		status: i.status ?? 'active',
		...(i.parent_code ? { parent_code: i.parent_code } : {})
	}));
	const next: MasterData & { excluded_codes?: string[] } = {
		...doc,
		schema_v: 3,
		items
	};
	delete next.excluded_codes;
	return next;
}

// ---------------------------------------------------------------- 1-default enforce

/** Returns a new array where exactly one item is `is_default: true`. If `next`
 *  is the chosen default, unset the previous default(s). If no item is chosen,
 *  the existing default (if any) is preserved. */
export function enforceOneDefault(
	items: readonly MasterDataItem[],
	nextDefaultCode?: string
): MasterDataItem[] {
	if (nextDefaultCode === undefined) {
		// No change requested — leave defaults alone (still validate at most 1).
		const defaults = items.filter((i) => i.is_default);
		if (defaults.length <= 1) return [...items];
		// Multiple defaults → keep first, unset the rest (defensive).
		let firstSeen = false;
		return items.map((i) => {
			if (i.is_default && !firstSeen) {
				firstSeen = true;
				return i;
			}
			return { ...i, is_default: false };
		});
	}
	return items.map((i) =>
		i.code === nextDefaultCode ? { ...i, is_default: true } : { ...i, is_default: false }
	);
}

// ---------------------------------------------------------------- factories

export function makeRegistryDoc<T extends string, B extends object>(
	type: T,
	schemaV: number,
	body: B,
	ctx: RegistryAuthorContext,
	id: string
): {
	_id: string;
	type: T;
	schema_v: number;
	created_at: string;
	updated_at: string;
	created_by: string;
} & B {
	const ts = new Date().toISOString();
	return {
		_id: id,
		type,
		schema_v: schemaV,
		created_at: ts,
		updated_at: ts,
		created_by: ctx.createdBy,
		...body
	};
}

/** Create a fresh master_data doc (used on first write / PUT replace). */
export function createMasterData(
	type: MasterDataType,
	items: readonly MasterDataItem[],
	ctx: RegistryAuthorContext,
	shelterCode?: string | null
): MasterData {
	return makeRegistryDoc(
		'master_data',
		3,
		{
			master_type: type,
			...(shelterCode ? { shelter_code: shelterCode } : {}),
			items: enforceOneDefault(items)
		},
		ctx,
		masterDocId(type, shelterCode)
	) as MasterData;
}

/** Update an existing master_data doc — re-stamps `updated_at` and
 *  calls {@link enforceOneDefault} to repair any multi-default state
 *  (converts multiple `is_default: true` items down to one, keeping
 *  the first default seen). */
export function touchMasterData(doc: MasterData): MasterData {
	return {
		...doc,
		updated_at: new Date().toISOString(),
		items: enforceOneDefault(doc.items)
	};
}

// ---------------------------------------------------------------- item operations

/** Pure operations on the items array — no I/O, easy to test. */
export type ItemOp =
	| { kind: 'add'; label: string; is_default?: boolean }
	| { kind: 'edit'; code: string; label?: string; is_default?: boolean }
	| { kind: 'setDefault'; code: string }
	| { kind: 'setStatus'; code: string; status: 'active' | 'inactive' };

export function applyItemOp(items: readonly MasterDataItem[], op: ItemOp): MasterDataItem[] {
	switch (op.kind) {
		case 'add': {
			const newItem: MasterDataItem = {
				code: `item_${ulid().toLowerCase()}`,
				label: op.label.trim(),
				is_default: op.is_default ?? false,
				status: 'active'
			};
			return enforceOneDefault([...items, newItem], op.is_default ? newItem.code : undefined);
		}
		case 'edit': {
			const updated = items.map((i) =>
				i.code === op.code
					? {
							...i,
							...(op.label !== undefined ? { label: op.label.trim() } : {}),
							...(op.is_default !== undefined ? { is_default: op.is_default } : {})
						}
					: i
			);
			return enforceOneDefault(updated, op.is_default === true ? op.code : undefined);
		}
		case 'setDefault':
			return enforceOneDefault(items, op.code);
		case 'setStatus':
			return items.map((i) => (i.code === op.code ? { ...i, status: op.status } : i));
	}
}
