import { qtyGt } from '$lib/utils/qty';
import {
	formatMasterLabelByCode,
	resolveMasterCodes,
	type MasterDataItem
} from '$lib/features/master-data';
import {
	calculateDistributedQtyForTicketItem,
	calculateInHandQtyForTicketItem,
	findAllergenConflicts,
	isDuplicateMealDistributionLog,
	matchRecipientToMenu,
	type DistributionLog,
	type MealPeriod,
	type MenuTagSource,
	type MenuTargetTag,
	type TicketItem
} from '../../domain/food-supplies';

/**
 * Normalized UI-level recipient selection for frontline handover.
 * Ephemeral presentation state only — never persisted directly.
 * Volunteers carry no menu tags (CR-159 FR-MRM-02) and no household.
 */
export type FrontlineRecipientSelection =
	| {
			recipientType: 'evacuee';
			recipientId: string; // 'evacuee:{ulid}'
			householdId?: string; // 'household:{ulid}'
			label: string;
			phone?: string | null;
			stayInfo?: string;
			/** Menu-matching tags derived from the evacuee doc at selection time. */
			menuTags?: MenuTargetTag[];
	  }
	| {
			recipientType: 'volunteer';
			recipientId: string; // 'volunteer:{ulid}'
			label: string;
			phone?: string | null;
			volunteerCode?: string;
	  }
	| {
			recipientType: 'outside';
			recipientId: null;
			label: string;
			notes?: string;
	  };

export interface ItemCapacitySummary {
	allocatedQty: string;
	distributedQty: string;
	inHandQty: string;
	isExhausted: boolean;
}

/**
 * Computes the capacity summary for a ticket line item based on ticket-scoped logs.
 */
export function getItemCapacitySummary(
	ticketId: string,
	targetItem: Pick<TicketItem, 'item_id' | 'allocated_qty'>,
	logs: readonly DistributionLog[]
): ItemCapacitySummary {
	const distributedQty = calculateDistributedQtyForTicketItem(ticketId, targetItem.item_id, logs);
	const inHandQty = calculateInHandQtyForTicketItem(ticketId, targetItem, logs);
	return {
		allocatedQty: targetItem.allocated_qty || '0',
		distributedQty,
		inHandQty,
		isExhausted: !qtyGt(inHandQty, '0')
	};
}

/** Evacuee or volunteer — someone a log can name, so a repeat meal can be caught (FR-DDS). */
export function isIdentifiedRecipient(recipient: FrontlineRecipientSelection | null): boolean {
	return recipient?.recipientType === 'evacuee' || recipient?.recipientType === 'volunteer';
}

/**
 * Validates whether the selected recipient is eligible to receive the given item.
 * Returnable loan items need a named borrower — an evacuee or a volunteer (FR-LON-01), never an
 * anonymous outside person.
 */
export function canRecipientReceiveItem(
	recipient: FrontlineRecipientSelection | null,
	isReturnable: boolean
): boolean {
	if (!recipient) return false;
	if (isReturnable) {
		return isIdentifiedRecipient(recipient) && Boolean(recipient.recipientId);
	}
	return true;
}

/**
 * Returns human-readable Thai error message explaining why the recipient cannot receive this item.
 */
export function getRecipientValidationErrorMessage(
	recipient: FrontlineRecipientSelection | null,
	isReturnable: boolean
): string | null {
	if (!recipient) {
		return 'กรุณาเลือกผู้รับก่อนทำรายการ';
	}
	if (isReturnable && recipient.recipientType === 'outside') {
		return "สิ่งของประเภท 'ต้องคืน' ต้องระบุผู้ยืม (ผู้ประสบภัยหรือจิตอาสา) ไม่สามารถแจกให้บุคคลภายนอกได้";
	}
	if (isReturnable && !recipient.recipientId) {
		return "สิ่งของประเภท 'ต้องคืน' จำเป็นต้องมีรหัสผู้รับที่ระบุตัวตนได้";
	}
	return null;
}

/**
 * Advisory check to determine if the recipient has already received a meal of the same period today.
 * Reuses the single-source-of-truth domain predicate `isDuplicateMealDistributionLog`.
 */
export function checkDuplicateMealAdvisory(
	recipientLogs: readonly DistributionLog[] | undefined,
	targetMeal: MealPeriod | undefined,
	referenceIsoOrDate: string | Date = new Date().toISOString()
): { isDuplicate: boolean; priorLog: DistributionLog | null } {
	if (!recipientLogs || recipientLogs.length === 0 || !targetMeal) {
		return { isDuplicate: false, priorLog: null };
	}

	const priorLog =
		recipientLogs.find((log) =>
			isDuplicateMealDistributionLog(log, targetMeal, referenceIsoOrDate)
		) ?? null;

	return {
		isDuplicate: Boolean(priorLog),
		priorLog
	};
}

const MENU_TAG_LABELS: Record<MenuTargetTag, string> = {
	HALAL: 'ฮาลาล',
	INFANT: 'ทารก',
	CHILD: 'เด็ก',
	ELDERLY: 'ผู้สูงอายุ'
};

/** Thai label list for menu target tags, e.g. `['HALAL', 'ELDERLY']` → `ฮาลาล, ผู้สูงอายุ`. */
export function formatMenuTags(tags: readonly MenuTargetTag[]): string {
	return tags.map((tag) => MENU_TAG_LABELS[tag]).join(', ');
}

/**
 * Advisory check whether the selected menu targets a group the recipient is not in.
 * An unknown menu (catalog not loaded / item missing) counts as a general menu.
 */
export function checkMenuMatchAdvisory(
	recipient: FrontlineRecipientSelection | null,
	menu: MenuTagSource | undefined
): { isMismatch: boolean; menuTags: MenuTargetTag[] } {
	if (!recipient || !menu) return { isMismatch: false, menuTags: [] };
	const recipientTags = recipient.recipientType === 'evacuee' ? (recipient.menuTags ?? []) : null;
	const { matches, menuTags } = matchRecipientToMenu(recipientTags, menu);
	return { isMismatch: !matches, menuTags };
}

export interface AllergenAdvisory {
	/** Recipient allergies that are master `allergy` codes — the only ones matched. */
	recipientCodes: string[];
	/** Recipient allergies kept as free text (legacy or off-list): shown, never matched. */
	recipientFreeText: string[];
	/** Menu allergens that are master codes. */
	menuCodes: string[];
	/** Menu allergens kept as free text: shown for staff to compare, never matched. */
	menuFreeText: string[];
	/** Codes the recipient is allergic to that the menu contains (FR-MRM-07). */
	conflicts: string[];
	/** The recipient has allergies but the menu lists no allergens (FR-MRM-09). */
	menuUnspecified: boolean;
}

const NO_ALLERGEN_ADVISORY: AllergenAdvisory = {
	recipientCodes: [],
	recipientFreeText: [],
	menuCodes: [],
	menuFreeText: [],
	conflicts: [],
	menuUnspecified: false
};

/**
 * Advisory allergy check for the selected menu (#607 FR-MRM-06..09). Only `evacuee` recipients
 * carry health data; volunteers and outside people skip it. Labels that match an active
 * `allergy` item become its code on both sides; anything else stays free text and is not matched.
 */
export function checkAllergenAdvisory(
	recipient: FrontlineRecipientSelection | null,
	recipientAllergies: readonly string[] | null | undefined,
	menuAllergens: readonly string[],
	allergyItems: readonly MasterDataItem[]
): AllergenAdvisory {
	if (recipient?.recipientType !== 'evacuee') return NO_ALLERGEN_ADVISORY;
	const codes = new Set(allergyItems.map((item) => item.code));
	const recipientValues = resolveMasterCodes(recipientAllergies ?? [], allergyItems);
	const recipientCodes = recipientValues.filter((v) => codes.has(v));
	const menuValues = resolveMasterCodes(menuAllergens, allergyItems);
	const menuCodes = menuValues.filter((v) => codes.has(v));
	return {
		recipientCodes,
		recipientFreeText: recipientValues.filter((v) => !codes.has(v)),
		menuCodes,
		menuFreeText: menuValues.filter((v) => !codes.has(v)),
		conflicts: findAllergenConflicts(recipientCodes, menuCodes),
		menuUnspecified: recipientValues.length > 0 && menuAllergens.length === 0
	};
}

/** Thai labels for `allergy` codes, e.g. `['seafood', 'egg']` → `อาหารทะเล, ไข่`. */
export function formatAllergyCodes(
	codes: readonly string[],
	allergyItems: readonly MasterDataItem[]
): string {
	return codes.map((code) => formatMasterLabelByCode(code, allergyItems) || code).join(', ');
}
