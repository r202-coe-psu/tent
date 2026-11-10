import { wasInShelterAllDay, type PresenceMovement } from '$lib/features/shared';
import type { CoverageResident } from '../../domain/food-supplies/meal-coverage';
import { thailandCalendarDay } from '../../domain/food-supplies';
import { historyRecipientNames } from './distribution-history';

interface CoverageEvacuee {
	_id: string;
	first_name: string;
	last_name: string;
	nickname?: string | null;
	current_stay?: { status?: string | null; since?: string | null } | null;
}

interface CoverageMovement extends PresenceMovement {
	evacuee_id: string;
}

/** Every evacuee as a coverage resident for Thai calendar `day`, presence derived from movements. */
export function coverageResidents(input: {
	day: string;
	evacuees: readonly CoverageEvacuee[];
	movements: readonly CoverageMovement[];
}): CoverageResident[] {
	const movementsByEvacuee = new Map<string, CoverageMovement[]>();
	for (const m of input.movements) {
		const list = movementsByEvacuee.get(m.evacuee_id) ?? [];
		list.push(m);
		movementsByEvacuee.set(m.evacuee_id, list);
	}
	const names = historyRecipientNames(input.evacuees);
	return input.evacuees.map((e) => ({
		id: e._id,
		name: names.get(e._id) ?? e._id,
		presentAllDay: wasInShelterAllDay({
			day: input.day,
			movements: movementsByEvacuee.get(e._id) ?? [],
			current_stay: e.current_stay
		})
	}));
}

/** Yesterday in Thailand — the latest day whose meals are all over. */
export function previousThaiDay(now: Date = new Date()): string {
	return thailandCalendarDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}
