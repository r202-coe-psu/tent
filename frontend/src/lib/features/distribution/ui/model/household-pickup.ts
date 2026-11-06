import type { MasterDataItem } from '$lib/features/master-data';
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
