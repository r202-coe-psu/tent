import { ulid } from '$lib/db/ulid';
import { parseQty, persistQty } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';
import { itemMasterUnit } from '$lib/features/catalog';
import { calculateNfiTarget, type DistributionRequestInput } from '../domain/distribution';
import type { DistributionTypeSnapshot } from '../domain/eligibility';

export const ALLOWED_BUFFER_PERCENTS = [5, 6, 7, 8, 9, 10] as const;
export type AllowedBufferPercent = (typeof ALLOWED_BUFFER_PERCENTS)[number];
export const DEFAULT_BUFFER_PERCENT: AllowedBufferPercent = 10;

/**
 * Maps Catalog distribution_type to Distribution request snapshot distribution_type.
 * Catalog 'recurring' -> Distribution 'consumable'
 * Catalog 'one_time'  -> Distribution 'one_time'
 */
export function catalogDistributionTypeToSnapshot(
	type: ItemMaster['distribution_type'] | undefined
): DistributionTypeSnapshot {
	return type === 'one_time' ? 'one_time' : 'consumable';
}

export interface CreateRequestFormItem {
	id: string;
	itemId: string;
	requestedQty: string;
	targetQtySnapshot: string;
}

export interface CreateRequestFormState {
	purpose: string;
	note: string;
	bufferPercent: number;
	items: CreateRequestFormItem[];
}

export interface NfiTemplatePreset {
	id: string;
	title: string;
	subtitle: string;
	description: string;
	isAvailable: boolean;
	unavailableReason?: string;
}

export const NFI_TEMPLATE_PRESETS: readonly NfiTemplatePreset[] = [
	{
		id: 'new_evacuee',
		title: 'ชุดรับผู้พักพิงใหม่',
		subtitle: 'สำหรับผู้ลงทะเบียนเข้าพักพิงใหม่',
		description: 'ชุดสิ่งของจำเป็นเบื้องต้นเมื่อเข้าสู่ศูนย์พักพิง',
		isAvailable: false,
		unavailableReason: 'ยังไม่พร้อมใช้งาน — ยังไม่มีการกำหนดรายการมาตรฐานใน Catalog'
	},
	{
		id: 'emergency_bedding',
		title: 'ชุดเครื่องนอนฉุกเฉิน',
		subtitle: 'เสื่อ ที่นอน หมอน ผ้าห่ม',
		description: 'สิ่งของเครื่องนอนสำหรับรองรับผู้พักพิงเพิ่มเติม',
		isAvailable: false,
		unavailableReason: 'ยังไม่พร้อมใช้งาน — ยังไม่มีการกำหนดรายการมาตรฐานใน Catalog'
	},
	{
		id: 'hygiene',
		title: 'ชุดสุขอนามัย',
		subtitle: 'สบู่ ยาสีฟัน แปรงสีฟัน ผ้าอนามัย',
		description: 'ชุดของใช้สุขอนามัยส่วนบุคคล',
		isAvailable: false,
		unavailableReason: 'ยังไม่พร้อมใช้งาน — ยังไม่มีการกำหนดรายการมาตรฐานใน Catalog'
	},
	{
		id: 'family',
		title: 'ชุดครอบครัว',
		subtitle: 'สิ่งของจำเป็นรายครัวเรือน',
		description: 'ชุดรวมสิ่งของจำเป็นสำหรับครัวเรือน',
		isAvailable: false,
		unavailableReason: 'ยังไม่พร้อมใช้งาน — ยังไม่มีการกำหนดรายการมาตรฐานใน Catalog'
	}
];

export function createInitialFormItem(defaultItemId = ''): CreateRequestFormItem {
	return {
		id: ulid(),
		itemId: defaultItemId,
		requestedQty: '',
		targetQtySnapshot: ''
	};
}

export function createInitialFormState(
	defaultBuffer: number = DEFAULT_BUFFER_PERCENT
): CreateRequestFormState {
	return {
		purpose: '',
		note: '',
		bufferPercent: defaultBuffer,
		items: [createInitialFormItem()]
	};
}

export interface FormValidationResult {
	valid: boolean;
	errors: Record<string, string>;
	payload?: DistributionRequestInput;
}

export function validateCreateRequestForm(
	state: CreateRequestFormState,
	activeHeadcount: number | null | undefined,
	itemMasters: readonly ItemMaster[]
): FormValidationResult {
	const errors: Record<string, string> = {};

	// 1. Purpose validation
	const trimmedPurpose = state.purpose.trim();
	if (!trimmedPurpose) {
		errors.purpose = 'กรุณาระบุวัตถุประสงค์การเบิกจ่าย';
	}

	// 2. Headcount validation
	if (
		activeHeadcount === null ||
		activeHeadcount === undefined ||
		!Number.isFinite(activeHeadcount) ||
		activeHeadcount < 0 ||
		!Number.isInteger(activeHeadcount)
	) {
		errors.headcount = 'ไม่สามารถดึงข้อมูลยอดผู้พักพิงจริงได้';
	}

	// 3. Buffer percent validation
	if (!ALLOWED_BUFFER_PERCENTS.includes(state.bufferPercent as AllowedBufferPercent)) {
		errors.bufferPercent = 'ค่าสำรอง (Buffer) ต้องเป็นจำนวนเต็มระหว่าง 5 ถึง 10%';
	}

	// 4. Calculate NFI Target if headcount and buffer are valid
	let targetQty = '0';
	if (!errors.headcount && !errors.bufferPercent) {
		try {
			targetQty = calculateNfiTarget({
				active_headcount: String(activeHeadcount),
				buffer_percent: state.bufferPercent
			});
		} catch {
			errors.headcount = 'คำนวณเป้าหมาย NFI ล้มเหลว';
		}
	}

	// 5. Items validation
	if (!state.items || state.items.length === 0) {
		errors.items = 'กรุณาระบุรายการสิ่งของอย่างน้อย 1 รายการ';
	}

	const itemMasterMap = new Map<string, ItemMaster>(
		itemMasters.map((master) => [master._id, master])
	);

	const validatedItems: DistributionRequestInput['items'] = [];

	state.items.forEach((item, index) => {
		if (!item.itemId) {
			errors[`item_${index}_id`] = 'กรุณาเลือกสิ่งของ';
			return;
		}

		const master = itemMasterMap.get(item.itemId);
		if (!master) {
			errors[`item_${index}_id`] = 'ไม่พบข้อมูลสิ่งของใน Catalog';
			return;
		}

		if (!item.requestedQty || item.requestedQty.trim() === '') {
			errors[`item_${index}_qty`] = 'กรุณาระบุจำนวน';
			return;
		}

		try {
			const parsed = parseQty(item.requestedQty);
			if (!parsed.isFinite() || !parsed.greaterThan(0)) {
				errors[`item_${index}_qty`] = 'จำนวนต้องเป็นตัวเลขที่มากกว่า 0';
				return;
			}

			const unit = itemMasterUnit(master);
			const distributionTypeSnapshot = catalogDistributionTypeToSnapshot(master.distribution_type);
			const normalizedQty = persistQty(parsed);

			validatedItems.push({
				item_id: master._id,
				requested_qty: normalizedQty,
				unit,
				distribution_type_snapshot: distributionTypeSnapshot,
				target_qty_snapshot: targetQty
			});
		} catch {
			errors[`item_${index}_qty`] = 'จำนวนไม่ถูกต้อง';
		}
	});

	if (Object.keys(errors).length > 0) {
		return { valid: false, errors };
	}

	const note = state.note.trim();
	const payload: DistributionRequestInput = {
		purpose: trimmedPurpose,
		...(note ? { note } : {}),
		active_headcount_snapshot: String(activeHeadcount),
		buffer_percent: state.bufferPercent,
		items: validatedItems
	};

	return { valid: true, errors: {}, payload };
}
