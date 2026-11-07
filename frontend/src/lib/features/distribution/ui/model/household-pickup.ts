import type { MasterDataItem } from '$lib/features/master-data';
import { formatThaiTime } from '$lib/utils/date';
import {
	deriveRecipientMenuTags,
	evaluateHouseholdMealPickup,
	type HouseholdPickupLog,
	type MealPeriod,
	type MenuTagSource
} from '../../domain/food-supplies';
import {
	checkAllergenAdvisory,
	checkMenuMatchAdvisory,
	formatAllergyCodes,
	formatMenuTags,
	type AllergenAdvisory,
	type FrontlineRecipientSelection
} from './frontline-handover';

type MenuProfile = Parameters<typeof deriveRecipientMenuTags>[0];

export type HouseholdPickupMemberDoc = MenuProfile & {
	_id: string;
	first_name: string;
	last_name?: string | null;
	nickname?: string | null;
	current_stay?: { status?: string | null } | null;
};

/** One in-shelter household member at the food desk (#1154). */
export interface HouseholdPickupRow {
	evacueeId: string;
	label: string;
	isCollector: boolean;
	/** Set when the member already received this meal today. */
	lastDistributedAt?: string;
	menuMismatchLabel: string | null;
	allergenConflictLabel: string | null;
	allergyLabel: string;
	allergen: AllergenAdvisory;
	menuTags: ReturnType<typeof deriveRecipientMenuTags>;
	/** Selecting this member needs an override reason (FR-MQW-05, FR-MRM-04/08/11). */
	needsOverride: boolean;
}

export function buildHouseholdPickupRows(input: {
	members: readonly HouseholdPickupMemberDoc[];
	logs: readonly HouseholdPickupLog[];
	meal: MealPeriod;
	at: string;
	collectorId: string;
	menu: MenuTagSource | undefined;
	menuAllergens: readonly string[];
	allergiesByEvacuee: Readonly<Record<string, readonly string[]>>;
	allergyItems: readonly MasterDataItem[];
}): HouseholdPickupRow[] {
	const byId = new Map(input.members.map((m) => [m._id, m]));
	const rows = evaluateHouseholdMealPickup(input).map((status) => {
		const member = byId.get(status.evacuee_id)!;
		const menuTags = deriveRecipientMenuTags(member);
		const selection: FrontlineRecipientSelection = {
			recipientType: 'evacuee',
			recipientId: member._id,
			label: '',
			menuTags
		};
		const menuCheck = checkMenuMatchAdvisory(selection, input.menu);
		const allergen = checkAllergenAdvisory(
			selection,
			input.allergiesByEvacuee[member._id],
			input.menuAllergens,
			input.allergyItems
		);
		const lastDistributedAt =
			status.status === 'already_received' ? status.last_distributed_at : undefined;
		return {
			evacueeId: member._id,
			label:
				[member.first_name, member.last_name].filter(Boolean).join(' ') +
				(member.nickname ? ` (${member.nickname})` : ''),
			isCollector: member._id === input.collectorId,
			lastDistributedAt,
			menuMismatchLabel: menuCheck.isMismatch ? formatMenuTags(menuCheck.menuTags) : null,
			allergenConflictLabel:
				allergen.conflicts.length > 0
					? formatAllergyCodes(allergen.conflicts, input.allergyItems)
					: null,
			allergyLabel: formatAllergyCodes(allergen.recipientCodes, input.allergyItems),
			allergen,
			menuTags,
			needsOverride:
				lastDistributedAt !== undefined ||
				menuCheck.isMismatch ||
				allergen.conflicts.length > 0 ||
				allergen.recipientFreeText.length > 0
		};
	});
	// The collector first: they are the one standing at the desk.
	return rows.sort((a, b) => Number(b.isCollector) - Number(a.isCollector));
}

/** Pre-selected: a member who can collect without an override (#1154 R4/R5). */
export function isPreselected(row: HouseholdPickupRow): boolean {
	return !row.needsOverride;
}

/**
 * Why a member is not ticked by default, one plain sentence per cause; empty when the member is
 * pre-selected. Ticking such a member needs an override reason.
 */
export function notPreselectedReasons(row: HouseholdPickupRow): string[] {
	const reasons: string[] = [];
	if (row.lastDistributedAt) {
		reasons.push(`รับมื้อนี้ไปแล้วเมื่อ ${formatThaiTime(row.lastDistributedAt)} น.`);
	}
	if (row.allergenConflictLabel)
		reasons.push(`เมนูนี้มี ${row.allergenConflictLabel} ซึ่งผู้รับแพ้`);
	if (row.allergen.recipientFreeText.length > 0) {
		reasons.push(
			`มีประวัติแพ้ที่ระบบเทียบกับเมนูให้ไม่ได้: ${row.allergen.recipientFreeText.join(', ')}`
		);
	}
	if (row.menuMismatchLabel) reasons.push(`เมนูนี้จัดไว้สำหรับกลุ่ม ${row.menuMismatchLabel}`);
	return reasons;
}

/**
 * Picks after a partial save (#1154 R8): members that saved are unticked; failed ones go back to
 * their default, which {@link isSelectedByDefault} works out from the refetched logs.
 */
export function picksAfterPartialFailure(
	rows: readonly Pick<HouseholdPickupRow, 'evacueeId'>[],
	failedIds: ReadonlySet<string>,
	key: (evacueeId: string) => string
): Record<string, boolean> {
	return Object.fromEntries(
		rows.filter((r) => !failedIds.has(r.evacueeId)).map((r) => [key(r.evacueeId), false])
	);
}

/**
 * Whether a member is ticked when the user has not touched it. A member whose save failed stays
 * ticked for the retry, even one that needs an override reason, unless the refetched logs show
 * the write landed after all (it is then "already received" and a retry would duplicate it).
 */
export function isSelectedByDefault(
	row: Pick<HouseholdPickupRow, 'evacueeId' | 'needsOverride' | 'lastDistributedAt'>,
	retryIds: ReadonlySet<string>
): boolean {
	if (retryIds.has(row.evacueeId)) return row.lastDistributedAt === undefined;
	return !row.needsOverride;
}
