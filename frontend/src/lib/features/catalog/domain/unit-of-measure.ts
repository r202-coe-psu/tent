import { z } from 'zod';
import { catalogDoc, type CatalogDoc, type AuthorContext } from '$lib/db/model';

export const dimensionSchema = z.enum(['count', 'mass', 'volume', 'length', 'energy']);
export type Dimension = z.infer<typeof dimensionSchema>;

export const unitCodeSchema = z
	.string()
	.trim()
	.regex(
		/^[a-z][a-z0-9_]{0,15}$/,
		'รหัสหน่วยต้องเป็นตัวอักษรภาษาอังกฤษตัวพิมพ์เล็ก ตัวเลข หรือขีดล่าง 1-16 ตัวอักษร'
	);

export function isCanonicalUnitCode(value: unknown): value is string {
	return typeof value === 'string' && unitCodeSchema.safeParse(value.trim()).success;
}

/**
 * Legacy labels are accepted only when reading/updating an existing document.
 * New documents must always carry a canonical code from the UOM master.
 */
export function isLegacyUnitLabel(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		!isCanonicalUnitCode(value.trim()) &&
		Object.prototype.hasOwnProperty.call(FALLBACK_UNIT_LABELS, value.trim())
	);
}

export interface UnitOfMeasure extends CatalogDoc {
	type: 'unit_of_measure';
	code: string;
	label_th: string;
	label_th_short?: string;
	label_en: string;
	dimension: Dimension;
	is_protected?: boolean;
	sort_order?: number;
	deactivated?: boolean;
}

export const unitOfMeasureInputSchema = z.object({
	code: unitCodeSchema,
	label_th: z.string().trim().min(1, 'กรุณาระบุชื่อภาษาไทย'),
	label_th_short: z.string().trim().optional(),
	label_en: z.string().trim().min(1, 'กรุณาระบุชื่อภาษาอังกฤษ'),
	dimension: dimensionSchema,
	is_protected: z.boolean().optional(),
	sort_order: z.number().optional(),
	deactivated: z.boolean().optional()
});

export type UnitOfMeasureInput = z.input<typeof unitOfMeasureInputSchema>;

export const unitOfMeasureUpdateSchema = z.object({
	label_th: z.string().trim().min(1, 'กรุณาระบุชื่อภาษาไทย'),
	label_th_short: z.string().trim().optional(),
	label_en: z.string().trim().min(1, 'กรุณาระบุชื่อภาษาอังกฤษ'),
	sort_order: z.number().optional(),
	deactivated: z.boolean().optional()
});

export type UnitOfMeasureUpdateInput = z.infer<typeof unitOfMeasureUpdateSchema>;

export function createUnitOfMeasure(input: UnitOfMeasureInput, ctx: AuthorContext): UnitOfMeasure {
	const d = unitOfMeasureInputSchema.parse(input);
	const doc = catalogDoc(
		'unit_of_measure',
		1,
		{
			code: d.code,
			label_th: d.label_th,
			...(d.label_th_short ? { label_th_short: d.label_th_short } : {}),
			label_en: d.label_en,
			dimension: d.dimension,
			is_protected: d.is_protected ?? false,
			...(typeof d.sort_order === 'number' ? { sort_order: d.sort_order } : {}),
			deactivated: d.deactivated ?? false
		},
		ctx.createdBy,
		d.code
	);
	return doc;
}

export const isUnitOfMeasure = (d: unknown): d is UnitOfMeasure =>
	!!d &&
	typeof d === 'object' &&
	(d as { type?: unknown }).type === 'unit_of_measure' &&
	typeof (d as { code?: unknown }).code === 'string';

export interface FallbackUnitDef {
	code: string;
	label_th: string;
	label_th_short?: string;
	label_en: string;
	dimension: Dimension;
	sort_order?: number;
	deactivated?: boolean;
}

export const FALLBACK_UNIT_DEFINITIONS: FallbackUnitDef[] = [
	{ code: 'piece', label_th: 'ชิ้น', label_en: 'pcs', dimension: 'count', sort_order: 1 },
	{ code: 'unit', label_th: 'หน่วย', label_en: 'unit', dimension: 'count', sort_order: 2 },
	{ code: 'item', label_th: 'อัน', label_en: 'item', dimension: 'count', sort_order: 3 },
	{ code: 'set', label_th: 'ชุด', label_en: 'set', dimension: 'count', sort_order: 4 },
	{ code: 'pair', label_th: 'คู่', label_en: 'pair', dimension: 'count', sort_order: 5 },
	{ code: 'box', label_th: 'กล่อง', label_en: 'box', dimension: 'count', sort_order: 6 },
	{ code: 'pack', label_th: 'แพ็ค', label_en: 'pack', dimension: 'count', sort_order: 7 },
	{ code: 'bag', label_th: 'ถุง', label_en: 'bag', dimension: 'count', sort_order: 8 },
	{ code: 'sachet', label_th: 'ซอง', label_en: 'sachet', dimension: 'count', sort_order: 9 },
	{ code: 'bottle', label_th: 'ขวด', label_en: 'bottle', dimension: 'count', sort_order: 10 },
	{ code: 'can', label_th: 'กระป๋อง', label_en: 'can', dimension: 'count', sort_order: 11 },
	{ code: 'tablet', label_th: 'เม็ด', label_en: 'tab', dimension: 'count', sort_order: 12 },
	{ code: 'bar', label_th: 'ก้อน', label_en: 'bar', dimension: 'count', sort_order: 13 },
	{ code: 'tube', label_th: 'หลอด', label_en: 'tube', dimension: 'count', sort_order: 14 },
	{ code: 'roll', label_th: 'ม้วน', label_en: 'roll', dimension: 'count', sort_order: 15 },
	{ code: 'sheet', label_th: 'แผ่น', label_en: 'sheet', dimension: 'count', sort_order: 16 },
	{ code: 'cloth', label_th: 'ผืน', label_en: 'cloth', dimension: 'count', sort_order: 17 },
	{ code: 'bundle', label_th: 'ห่อ', label_en: 'bundle', dimension: 'count', sort_order: 18 },
	{ code: 'egg', label_th: 'ฟอง', label_en: 'egg', dimension: 'count', sort_order: 19 },
	{ code: 'fruit', label_th: 'ผล', label_en: 'fruit', dimension: 'count', sort_order: 20 },
	{ code: 'gallon', label_th: 'แกลลอน', label_en: 'gallon', dimension: 'volume', sort_order: 21 },
	{ code: 'cylinder', label_th: 'ถัง', label_en: 'cylinder', dimension: 'count', sort_order: 22 },
	{
		code: 'g',
		label_th: 'กรัม',
		label_th_short: 'ก.',
		label_en: 'g',
		dimension: 'mass',
		sort_order: 23
	},
	{
		code: 'kg',
		label_th: 'กิโลกรัม',
		label_th_short: 'กก.',
		label_en: 'kg',
		dimension: 'mass',
		sort_order: 24
	},
	{
		code: 'ml',
		label_th: 'มิลลิลิตร',
		label_th_short: 'มล.',
		label_en: 'ml',
		dimension: 'volume',
		sort_order: 25
	},
	{
		code: 'l',
		label_th: 'ลิตร',
		label_th_short: 'ล.',
		label_en: 'L',
		dimension: 'volume',
		sort_order: 26
	},
	{
		code: 'm',
		label_th: 'เมตร',
		label_th_short: 'ม.',
		label_en: 'm',
		dimension: 'length',
		sort_order: 27
	},
	{
		code: 'mg',
		label_th: 'มิลลิกรัม',
		label_th_short: 'มก.',
		label_en: 'mg',
		dimension: 'mass',
		sort_order: 28
	},
	{
		code: 'mcg',
		label_th: 'ไมโครกรัม',
		label_th_short: 'มคก.',
		label_en: 'mcg',
		dimension: 'mass',
		sort_order: 29
	},
	{
		code: 'kcal',
		label_th: 'กิโลแคลอรี',
		label_th_short: 'กิโลแคลอรี',
		label_en: 'kcal',
		dimension: 'energy',
		sort_order: 30
	}
];

export const FALLBACK_UNIT_LABELS: Record<string, { th: string; th_short?: string; en: string }> = {
	...Object.fromEntries(
		FALLBACK_UNIT_DEFINITIONS.map((u) => [
			u.code,
			{ th: u.label_th, th_short: u.label_th_short, en: u.label_en }
		])
	),
	pcs: { th: 'ชิ้น', en: 'pcs' },
	gram: { th: 'กรัม', th_short: 'ก.', en: 'g' },
	litre: { th: 'ลิตร', th_short: 'ล.', en: 'L' },
	// Legacy Thai labels backward-compat mapping
	ชิ้น: { th: 'ชิ้น', en: 'pcs' },
	หน่วย: { th: 'หน่วย', en: 'unit' },
	อัน: { th: 'อัน', en: 'item' },
	ตัว: { th: 'ตัว', en: 'pcs' },
	ชุด: { th: 'ชุด', en: 'set' },
	คู่: { th: 'คู่', en: 'pair' },
	กล่อง: { th: 'กล่อง', en: 'box' },
	แพ็ค: { th: 'แพ็ค', en: 'pack' },
	ถุง: { th: 'ถุง', en: 'bag' },
	ซอง: { th: 'ซอง', en: 'sachet' },
	ขวด: { th: 'ขวด', en: 'bottle' },
	กระป๋อง: { th: 'กระป๋อง', en: 'can' },
	เม็ด: { th: 'เม็ด', en: 'tab' },
	ก้อน: { th: 'ก้อน', en: 'bar' },
	หลอด: { th: 'หลอด', en: 'tube' },
	ม้วน: { th: 'ม้วน', en: 'roll' },
	แผ่น: { th: 'แผ่น', en: 'sheet' },
	ผืน: { th: 'ผืน', en: 'cloth' },
	ห่อ: { th: 'ห่อ', en: 'bundle' },
	ฟอง: { th: 'ฟอง', en: 'egg' },
	ผล: { th: 'ผล', en: 'fruit' },
	แกลลอน: { th: 'แกลลอน', en: 'gallon' },
	ถัง: { th: 'ถัง', en: 'cylinder' },
	กรัม: { th: 'กรัม', th_short: 'ก.', en: 'g' },
	กิโลกรัม: { th: 'กิโลกรัม', th_short: 'กก.', en: 'kg' },
	กก: { th: 'กิโลกรัม', th_short: 'กก.', en: 'kg' },
	'กก.': { th: 'กิโลกรัม', th_short: 'กก.', en: 'kg' },
	มิลลิลิตร: { th: 'มิลลิลิตร', th_short: 'มล.', en: 'ml' },
	ลิตร: { th: 'ลิตร', th_short: 'ล.', en: 'L' },
	เมตร: { th: 'เมตร', th_short: 'ม.', en: 'm' }
};

export function formatUnit(
	code: string | undefined | null,
	units?: readonly (UnitOfMeasure | FallbackUnitDef)[] | null,
	lang: string = 'th',
	optionsOrShort: boolean | { short?: boolean } = false
): string {
	if (!code || typeof code !== 'string') return '';
	const trimmed = code.trim();
	if (!trimmed) return '';

	const isShort = typeof optionsOrShort === 'boolean' ? optionsOrShort : !!optionsOrShort?.short;
	const isEn = lang === 'en';

	if (units && units.length > 0) {
		const matched = units.find((u) => u.code.toLowerCase() === trimmed.toLowerCase());
		if (matched) {
			if (isEn) return matched.label_en || matched.code;
			if (isShort && matched.label_th_short) return matched.label_th_short;
			return matched.label_th || matched.code;
		}
	}

	const fallback = FALLBACK_UNIT_LABELS[trimmed] || FALLBACK_UNIT_LABELS[trimmed.toLowerCase()];

	if (fallback) {
		if (isEn) return fallback.en || trimmed;
		if (isShort && fallback.th_short) return fallback.th_short;
		return fallback.th || trimmed;
	}

	return trimmed;
}

export function assertKnownUnitCodes(
	codes: readonly string[],
	units: readonly UnitOfMeasure[],
	options: { allowDeactivated?: readonly string[] } = {}
): void {
	const allowedDeactivated = new Set(
		(options.allowDeactivated ?? []).map((code) => code.trim().toLowerCase())
	);
	const byCode = new Map(units.map((unit) => [unit.code.trim().toLowerCase(), unit]));

	for (const rawCode of codes) {
		const code = rawCode.trim();
		if (!isCanonicalUnitCode(code)) {
			throw new Error(`Unit must be a valid lowercase English code: ${rawCode}`);
		}

		const unit = byCode.get(code.toLowerCase());
		if (!unit) {
			throw new Error(`Unknown unit of measure: ${code}`);
		}
		if (unit.deactivated && !allowedDeactivated.has(code.toLowerCase())) {
			throw new Error(`Unit of measure is deactivated: ${code}`);
		}
	}
}
