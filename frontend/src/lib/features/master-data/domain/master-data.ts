import { z } from 'zod';

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
 * Item display names are bilingual (`label_th` / `label_en`). New items require
 * a user-supplied snake_case `code` (no `item_{ulid}` auto-generation).
 */

// ---------------------------------------------------------------- master types

export const MASTER_DATA_TYPES = [
	'vulnerable_group',
	'housing_type',
	'shelter_type',
	'volunteer_skills'
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
	'vulnerable_group'
] as const satisfies readonly MasterDataType[];

/** Types shown on the Household Master Data page. */
export const HOUSEHOLD_MASTER_TYPES = ['housing_type'] as const satisfies readonly MasterDataType[];

/** Types shown on the Shelter Config page. */
export const SHELTER_MASTER_TYPES = ['shelter_type'] as const satisfies readonly MasterDataType[];

/** Types shown on the Volunteer Skills Config page. */
export const VOLUNTEER_MASTER_TYPES = [
	'volunteer_skills'
] as const satisfies readonly MasterDataType[];

/** Thai + English labels for the master_type enum — used in the type list cards. */
export const MASTER_DATA_TYPE_LABELS: Record<MasterDataType, string> = {
	vulnerable_group: 'ประเภทกลุ่มเปราะบาง (Vulnerable Group)',
	housing_type: 'ประเภทที่อยู่อาศัย (Housing Type)',
	shelter_type: 'ประเภทศูนย์พักพิง (Shelter Type)',
	volunteer_skills: 'ทักษะมาตรฐานจิตอาสา (Volunteer Skills)'
};

/** Hub copy: sidebar short title, panel title/lead, and forms that consume each type. */
export interface MasterDataTypeMeta {
	shortTitle: string;
	title: string;
	description: string;
	affectedForms: readonly string[];
}

export const MASTER_DATA_TYPE_META: Record<MasterDataType, MasterDataTypeMeta> = {
	vulnerable_group: {
		shortTitle: 'กลุ่มเปราะบาง',
		title: 'กลุ่มเปราะบาง',
		description: 'รายการกลุ่มเปราะบางที่เจ้าหน้าที่เลือกได้ตอนลงทะเบียนและคัดกรอง',
		affectedForms: ['ลงทะเบียนบุคคล / คัดกรอง EWAR', 'นโยบายรับเข้าศูนย์', 'คิวจัดโซนที่พัก']
	},
	housing_type: {
		shortTitle: 'ประเภทที่อยู่',
		title: 'ประเภทที่อยู่อาศัย',
		description: 'ประเภทบ้าน/ที่พักก่อนอพยพ ที่ใช้ในที่อยู่ครัวเรือน',
		affectedForms: [
			'ฟอร์มที่อยู่ครัวเรือน (ลงทะเบียนล่วงหน้า / หลังถึงศูนย์)',
			'แก้ไขครัวเรือน',
			'จองที่พักสาธารณะ'
		]
	},
	shelter_type: {
		shortTitle: 'ประเภทศูนย์',
		title: 'ประเภทศูนย์พักพิง',
		description: 'ประเภทอาคาร/สถานที่ของศูนย์ ที่ใช้ตอนตั้งค่าและแสดงผลศูนย์',
		affectedForms: ['ฟอร์มข้อมูลศูนย์', 'นำเข้าศูนย์', 'รายการ/โปรไฟล์ศูนย์']
	},
	volunteer_skills: {
		shortTitle: 'ทักษะอาสา',
		title: 'ทักษะมาตรฐานจิตอาสา',
		description: 'ทักษะที่กำหนดงานอาสาและให้ผู้สมัครเลือก',
		affectedForms: ['ตั้งค่างานอาสา', 'สมัครอาสา (สาธารณะ)', 'โปรไฟล์/มอบหมายอาสา']
	}
};

/**
 * CR-112 Vulnerable Group active seed set (stable codes = keys).
 * Legacy hard-migrate: `elderly` → `elderly_dependent`; `disabled` → `disability_other`.
 */
export const CR112_VULNERABLE_GROUP_ACTIVE = [
	{ code: 'bedridden', label_th: 'ผู้ป่วยติดเตียง', label_en: 'Bedridden', is_default: false },
	{ code: 'dialysis', label_th: 'ผู้ป่วยฟอกไต', label_en: 'Dialysis patient', is_default: false },
	{ code: 'wheelchair', label_th: 'ผู้ใช้วีลแชร์', label_en: 'Wheelchair user', is_default: false },
	{
		code: 'psychiatric',
		label_th: 'ผู้ป่วยจิตเวช',
		label_en: 'Psychiatric patient',
		is_default: false
	},
	{
		code: 'elderly_dependent',
		label_th: 'ผู้สูงอายุช่วยเหลือตัวเองไม่ได้',
		label_en: 'Dependent elderly',
		is_default: false
	},
	{ code: 'infant', label_th: 'ทารก', label_en: 'Infant', is_default: false },
	{ code: 'young_child', label_th: 'เด็กเล็ก', label_en: 'Young child', is_default: false },
	{ code: 'pregnant', label_th: 'สตรีมีครรภ์', label_en: 'Pregnant', is_default: false },
	{
		code: 'vision_impaired',
		label_th: 'ผู้พิการทางการมองเห็น',
		label_en: 'Vision impaired',
		is_default: false
	},
	{
		code: 'hearing_impaired',
		label_th: 'ผู้พิการทางการได้ยิน',
		label_en: 'Hearing impaired',
		is_default: false
	},
	{
		code: 'disability_other',
		label_th: 'ผู้พิการ (อื่นๆ / ไม่ระบุรายละเอียด)',
		label_en: 'Disability (other / unspecified)',
		is_default: false
	},
	{
		code: 'chronic_illness',
		label_th: 'ผู้มีโรคประจำตัว/เรื้อรัง',
		label_en: 'Chronic illness',
		is_default: false
	}
] as const;

/** Stable id: global docs use `master_data:{type}`, local docs append the shelter code. */
export function masterDocId(type: MasterDataType, shelterCode?: string | null): string {
	return shelterCode ? `master_data:${type}:${shelterCode}` : `master_data:${type}`;
}

// ---------------------------------------------------------------- items / codes

/** Auto-generated ULID codes from schema_v 3 — editable escape hatch on edit. */
export const LEGACY_ITEM_CODE_RE = /^item_/i;

export function isLegacyItemCode(code: string): boolean {
	return LEGACY_ITEM_CODE_RE.test(code);
}

/** Normalize a user/seed code to lower_snake; `null` when invalid. */
export function normalizeMasterCode(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	const code = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');
	if (!code || !/^[a-z0-9_]+$/.test(code)) return null;
	return code;
}

export const itemInputSchema = z.object({
	code: z
		.string()
		.trim()
		.min(1, 'Code is required')
		.regex(/^[a-z0-9_]+$/, 'Code must be lower_snake'),
	label_th: z.string().trim().min(1, 'Thai label is required'),
	label_en: z.string().trim().min(1, 'English label is required'),
	is_default: z.boolean().default(false)
});
export type ItemInput = z.input<typeof itemInputSchema>;

/** Lift a legacy single-`label` item to label_th/label_en. New bilingual
 *  writes must supply both fields — only the old `label` key backfills. */
export function normalizeMasterItemLabels(raw: unknown): unknown {
	if (!raw || typeof raw !== 'object') return raw;
	const o = raw as Record<string, unknown>;
	const legacy = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : undefined;
	const hasTh = typeof o.label_th === 'string' && o.label_th.trim().length > 0;
	const hasEn = typeof o.label_en === 'string' && o.label_en.trim().length > 0;
	const rest = { ...o };
	delete rest.label;
	if (!legacy && hasTh && hasEn) {
		return {
			...rest,
			label_th: (o.label_th as string).trim(),
			label_en: (o.label_en as string).trim()
		};
	}
	if (legacy) {
		return {
			...rest,
			label_th: hasTh ? (o.label_th as string).trim() : legacy,
			label_en: hasEn ? (o.label_en as string).trim() : legacy
		};
	}
	return rest;
}

export const masterDataItemSchema = z.preprocess(
	normalizeMasterItemLabels,
	z.object({
		code: z
			.string()
			.trim()
			.min(1)
			.regex(/^[a-z0-9_]+$/, 'Code must be lower_snake'),
		label_th: z.string().trim().min(1),
		label_en: z.string().trim().min(1),
		is_default: z.boolean(),
		status: z.enum(['active', 'inactive']).default('active'),
		parent_code: z.string().trim().min(1).optional(),
		category: z.enum(['GENERAL', 'CONTROLLED', 'operational', 'controlled']).optional(),
		description: z.string().trim().optional()
	})
);
export type MasterDataItem = z.infer<typeof masterDataItemSchema>;

export type MasterLabelFields = Pick<MasterDataItem, 'code' | 'label_th' | 'label_en'>;

/**
 * Pick display name by language; fallback th → en → code (or en → th → code).
 * Domain is pure — callers pass `lang` from `langState.current`.
 */
export function formatMasterLabel(
	item: MasterLabelFields | null | undefined,
	lang: string = 'th'
): string {
	if (!item) return '';
	const th = item.label_th?.trim() ?? '';
	const en = item.label_en?.trim() ?? '';
	if (lang === 'en') return en || th || item.code;
	return th || en || item.code;
}

/** Resolve a stored code against a master list, then format by lang. */
export function formatMasterLabelByCode(
	code: string | null | undefined,
	items: readonly MasterDataItem[],
	lang: string = 'th'
): string {
	if (!code) return '';
	const item = items.find((i) => i.code === code);
	if (!item) return code.startsWith('item_') ? '' : code;
	return formatMasterLabel(item, lang);
}

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
 * Comparison-only: stored labels keep the operator's exact spelling.
 */
export function normalizeLabel(label: string): string {
	return label
		.normalize('NFC')
		.replace(INVISIBLE_CHARS, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export type MasterLabelField = 'label_th' | 'label_en';

/** Collision key scoped by language so th/en duplicates are checked separately. */
export function labelCollisionKey(field: MasterLabelField, label: string): string {
	return `${field}:${normalizeLabel(label)}`;
}

/**
 * First item whose `field` label collides with `label`, or `undefined`
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
	field: MasterLabelField = 'label_th',
	excludeCode?: string
): MasterDataItem | undefined {
	const target = normalizeLabel(label);
	if (!target) return undefined;
	return items.find((i) => i.code !== excludeCode && normalizeLabel(i[field]) === target);
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
 * Normalized label keys that ALREADY appear more than once across `itemGroups`
 * (CR-078). Keys are `label_th:…` / `label_en:…` so each language is tracked
 * separately. Grandfathered for writes that predate the uniqueness rule.
 */
export function duplicateLabelKeys(
	...itemGroups: readonly (readonly MasterDataItem[])[]
): Set<string> {
	const seen = new Set<string>();
	const duplicated = new Set<string>();
	for (const group of itemGroups) {
		for (const item of group) {
			for (const field of ['label_th', 'label_en'] as const) {
				const key = labelCollisionKey(field, item[field]);
				if (seen.has(key)) duplicated.add(key);
				seen.add(key);
			}
		}
	}
	return duplicated;
}

/**
 * Whole-list guard for the write path (CR-078): the first label that collides
 * either inside `items` itself or with `against`, or `undefined` when clean.
 *
 * Checks `label_th` and `label_en` separately (same text in different languages
 * across items is fine; same text in the same language is not).
 *
 * `against` carries the items of the OTHER tier — global items when validating
 * a shelter-local write, and every shelter-local item when validating a global
 * write. The check is symmetric because the shelter UI renders the merged
 * global + local list, so a collision from either direction produces two rows
 * that read identically.
 *
 * `grandfathered` (see {@link duplicateLabelKeys}) holds keys that already
 * collided before this write; those are skipped so pre-existing data never
 * blocks an unrelated edit. Returns the label as stored (not normalized)
 * so the message can quote what the operator sees.
 */
export function findLabelCollision(
	items: readonly MasterDataItem[],
	against: readonly MasterDataItem[] = [],
	grandfathered: ReadonlySet<string> = new Set()
): string | undefined {
	const seen = new Set<string>();
	for (const item of against) {
		seen.add(labelCollisionKey('label_th', item.label_th));
		seen.add(labelCollisionKey('label_en', item.label_en));
	}
	for (const item of items) {
		for (const field of ['label_th', 'label_en'] as const) {
			const key = labelCollisionKey(field, item[field]);
			if (seen.has(key) && !grandfathered.has(key)) return item[field];
			seen.add(key);
		}
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
	schema_v: 1 | 2 | 3 | 4;
	master_type: MasterDataType;
	shelter_code?: string;
	items: MasterDataItem[];
	/** Shelter-local only: ULID codes of GLOBAL items this shelter has disabled
	 *  (per-shelter deactivate; global doc untouched). Absent = none. */
	disabled_global_codes?: string[];
	/** Shelter-local only: code of a GLOBAL item this shelter has chosen as its
	 *  default (CR-049 amendment). The global item's labels/`is_default` are
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
	schema_v: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
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

// ---------------------------------------------------------------- migration

/** A pre-v4 master_data doc: items may still use single `label`, lack `status`,
 *  or carry leftover `excluded_codes`. */
type LegacyMasterItem = {
	code: string;
	label?: string;
	label_th?: string;
	label_en?: string;
	is_default: boolean;
	status?: MasterDataItem['status'];
	parent_code?: string;
	category?: MasterDataItem['category'];
	description?: string;
};
type LegacyMasterData = Omit<MasterData, 'schema_v' | 'items'> & {
	schema_v?: number;
	items?: LegacyMasterItem[];
	excluded_codes?: string[];
};

function coerceItem(i: LegacyMasterItem): MasterDataItem {
	const parsed = masterDataItemSchema.parse({
		code: i.code,
		label: i.label,
		label_th: i.label_th,
		label_en: i.label_en,
		is_default: i.is_default,
		status: i.status ?? 'active',
		...(i.parent_code ? { parent_code: i.parent_code } : {}),
		...(i.category ? { category: i.category } : {}),
		...(i.description !== undefined ? { description: i.description } : {})
	});
	return parsed;
}

/** True when a doc still needs the v4 shape: schema_v < 4, leftover
 *  `excluded_codes`, missing item `status`, or single-`label` items. */
export function needsMasterDataMigration(doc: LegacyMasterData): boolean {
	if ((doc.schema_v ?? 0) < 4) return true;
	if ('excluded_codes' in doc && doc.excluded_codes !== undefined) return true;
	return (doc.items ?? []).some(
		(i) =>
			i.status === undefined ||
			typeof i.label_th !== 'string' ||
			typeof i.label_en !== 'string' ||
			(typeof i.label === 'string' && i.label_th === undefined)
	);
}

/** @deprecated Prefer {@link migrateMasterDataToV4}. Kept for callers still on v3 gate. */
export function migrateMasterDataToV3(doc: LegacyMasterData): MasterData {
	return migrateMasterDataToV4(doc);
}

/** Migrate a master_data doc to schema_v 4: bilingual labels, backfill `status`,
 *  drop `excluded_codes`. Pure — no I/O, no clock. */
export function migrateMasterDataToV4(doc: LegacyMasterData): MasterData {
	const items: MasterDataItem[] = (doc.items ?? []).map(coerceItem);
	const next: MasterData & { excluded_codes?: string[] } = {
		...doc,
		schema_v: 4,
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
		4,
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
	| {
			kind: 'add';
			code: string;
			label_th: string;
			label_en: string;
			is_default?: boolean;
			category?: 'operational' | 'controlled' | 'GENERAL' | 'CONTROLLED';
			description?: string;
	  }
	| {
			kind: 'edit';
			code: string;
			/** Rename only when current code is legacy `item_*`. */
			newCode?: string;
			label_th?: string;
			label_en?: string;
			is_default?: boolean;
			category?: 'operational' | 'controlled' | 'GENERAL' | 'CONTROLLED';
			description?: string;
	  }
	| { kind: 'delete'; code: string }
	| { kind: 'setDefault'; code: string }
	| { kind: 'setStatus'; code: string; status: 'active' | 'inactive' };

export function applyItemOp(items: readonly MasterDataItem[], op: ItemOp): MasterDataItem[] {
	switch (op.kind) {
		case 'add': {
			const code = normalizeMasterCode(op.code);
			if (!code) {
				throw new Error('Master data item code is required and must be lower_snake (a-z, 0-9, _)');
			}
			if (items.some((i) => i.code === code)) {
				throw new Error(`Master data item code "${code}" already exists`);
			}
			const newItem: MasterDataItem = {
				code,
				label_th: op.label_th.trim(),
				label_en: op.label_en.trim(),
				is_default: op.is_default ?? false,
				status: 'active',
				...(op.category ? { category: op.category } : {}),
				...(op.description !== undefined ? { description: op.description.trim() } : {})
			};
			return enforceOneDefault([...items, newItem], op.is_default ? newItem.code : undefined);
		}
		case 'edit': {
			const current = items.find((i) => i.code === op.code);
			if (!current) return [...items];

			let nextCode = op.code;
			if (op.newCode !== undefined && op.newCode !== op.code) {
				if (!isLegacyItemCode(op.code)) {
					throw new Error('Only legacy item_* codes may be renamed');
				}
				const renamed = normalizeMasterCode(op.newCode);
				if (!renamed) {
					throw new Error('New code must be lower_snake (a-z, 0-9, _)');
				}
				if (items.some((i) => i.code === renamed && i.code !== op.code)) {
					throw new Error(`Master data item code "${renamed}" already exists`);
				}
				nextCode = renamed;
			}

			const updated = items.map((i) =>
				i.code === op.code
					? {
							...i,
							code: nextCode,
							...(op.label_th !== undefined ? { label_th: op.label_th.trim() } : {}),
							...(op.label_en !== undefined ? { label_en: op.label_en.trim() } : {}),
							...(op.is_default !== undefined ? { is_default: op.is_default } : {}),
							...(op.category !== undefined ? { category: op.category } : {}),
							...(op.description !== undefined ? { description: op.description.trim() } : {})
						}
					: i
			);
			return enforceOneDefault(updated, op.is_default === true ? nextCode : undefined);
		}
		case 'delete':
			return enforceOneDefault(items.filter((i) => i.code !== op.code));
		case 'setDefault':
			return enforceOneDefault(items, op.code);
		case 'setStatus':
			return items.map((i) => (i.code === op.code ? { ...i, status: op.status } : i));
	}
}
