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
	'house_damage'
] as const;
export type MasterDataType = (typeof MASTER_DATA_TYPES)[number];

export const masterTypeSchema = z.enum(MASTER_DATA_TYPES);

/** Thai + English labels for the master_type enum — used in the type list cards. */
export const MASTER_DATA_TYPE_LABELS: Record<MasterDataType, string> = {
	vulnerable_group: 'ประเภทกลุ่มเปราะบาง (Vulnerable Group)',
	health_condition: 'โรคประจำตัวและอาการแพ้ (Health Condition)',
	dietary_restrictions: 'ศาสนาและข้อจำกัดอาหาร (Dietary Restrictions)',
	pet_types: 'ประเภทสัตว์เลี้ยง (Pet Types)',
	house_damage: 'สถานะความเสียหายของบ้าน (House Damage)'
};

/** Stable `code` used as the doc id — registry has no `shelter_code` (global). */
export function masterDocId(type: MasterDataType): string {
	return `master_data:${type}`;
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
	is_default: z.boolean()
});
export type MasterDataItem = z.infer<typeof masterDataItemSchema>;

// ---------------------------------------------------------------- document

/** Author context for a registry doc (no `shelter_code` — global). */
export interface RegistryAuthorContext {
	createdBy: string;
}

export interface MasterData {
	_id: string;
	_rev?: string;
	type: 'master_data';
	schema_v: 1;
	master_type: MasterDataType;
	items: MasterDataItem[];
	created_at: string;
	updated_at: string;
	created_by: string;
}

export const masterDataSchema = z.object({
	_id: z.string().min(1),
	_rev: z.string().optional(),
	type: z.literal('master_data'),
	schema_v: z.literal(1),
	master_type: masterTypeSchema,
	items: z.array(masterDataItemSchema).min(0),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
});

export const isMasterData = (d: unknown): d is MasterData =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'master_data';

// ---------------------------------------------------------------- slugify

/**
 * Hand-curated dictionary for labels that don't transliterate cleanly from Thai
 * to a readable lower_snake `code`. Keep this list short — only seeds that
 * field study has already committed to. Anything not in the dict falls through
 * to `slugifyAscii()` (transliterate) and a `_<ulid>` suffix on collision.
 */
const SLUG_DICT: Record<string, string> = {
	ผู้สูงอายุ: 'elderly',
	ผู้พิการ: 'disabled',
	หญิงตั้งครรภ์: 'pregnant',
	เด็กเล็ก: 'infant',
	โรคเรื้อรัง: 'chronic_illness',
	แพ้อาหาร: 'allergy_food',
	แพ้ยา: 'allergy_drug',
	หอบหืด: 'asthma',
	'อิสลาม (Halal)': 'halal',
	มังสวิรัติ: 'vegetarian',
	อาหารอ่อน: 'soft_food',
	ไม่ทานหมู: 'no_pork',
	เบาหวาน: 'diabetic',
	สุนัข: 'dog',
	แมว: 'cat',
	นก: 'bird',
	อื่นๆ: 'other',
	เสียหายบางส่วน: 'partial',
	เสียหายหนัก: 'severe',
	เสียหายทั้งหมด: 'total_loss'
};

/** Lightweight transliteration — keeps ascii lower_snake; non-mappable → ''. */
function slugifyAscii(label: string): string {
	return label
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_+/g, '_');
}

/** Returns a `code` candidate for the given label — caller is responsible for
 *  uniqueness check (append ULID if collision). */
export function slugifyLabel(label: string): string {
	const trimmed = label.trim();
	if (SLUG_DICT[trimmed]) return SLUG_DICT[trimmed];
	const ascii = slugifyAscii(trimmed);
	if (ascii) return ascii;
	// All-non-ascii label with no dict entry → stable fallback via ULID.
	return `item_${ulid().toLowerCase()}`;
}

/** Returns a unique `code` against the existing items list (appends ULID on
 *  collision). Pure — no I/O. */
export function uniqueCode(label: string, existing: readonly MasterDataItem[]): string {
	const base = slugifyLabel(label);
	const taken = new Set(existing.map((i) => i.code));
	if (!taken.has(base)) return base;
	return `${base}_${ulid().toLowerCase()}`;
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
	ctx: RegistryAuthorContext
): MasterData {
	return makeRegistryDoc(
		'master_data',
		1,
		{ master_type: type, items: enforceOneDefault(items) },
		ctx,
		masterDocId(type)
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
	| { kind: 'delete'; code: string }
	| { kind: 'setDefault'; code: string };

export function applyItemOp(items: readonly MasterDataItem[], op: ItemOp): MasterDataItem[] {
	switch (op.kind) {
		case 'add': {
			const newItem: MasterDataItem = {
				code: uniqueCode(op.label, items),
				label: op.label.trim(),
				is_default: op.is_default ?? false
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
		case 'delete':
			return items.filter((i) => i.code !== op.code);
		case 'setDefault':
			return enforceOneDefault(items, op.code);
	}
}
