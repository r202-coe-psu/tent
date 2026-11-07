import { createQuery } from '@tanstack/svelte-query';
import {
	countShelterPeople,
	isInShelterStayStatus,
	totalShelterPeople
} from '$lib/features/shared';
import { peopleRepository } from '$lib/features/people';
import { volunteerRepositoryFor } from '$lib/features/volunteers';
import { listShelterStaff } from '$lib/features/users';
import { presentRecipientKeys } from '../domain/one-time-demand';

export const shelterPeopleKeys = {
	all: ['sop_ratios', 'shelter_people'] as const,
	counts: (shelterCode: string) => [...shelterPeopleKeys.all, shelterCode] as const
};

export const useShelterPeopleCounts = (shelterCode: () => string) =>
	createQuery(() => {
		const code = shelterCode();
		return {
			queryKey: shelterPeopleKeys.counts(code),
			enabled: Boolean(code),
			queryFn: async () => {
				const [occupants, volunteers, staff] = await Promise.all([
					peopleRepository().listEvacuees(),
					volunteerRepositoryFor(code).list(),
					listShelterStaff(code)
				]);
				const counts = countShelterPeople(code, occupants, volunteers, staff);
				// Which `distribution_log` recipient ids are people counted above, to tell who is still here.
				const linkedUserNames = new Set(volunteers.map((v) => v.user_name).filter(Boolean));
				const recipientKeys = [
					...presentRecipientKeys({
						evacueeIds: occupants
							.filter((o) => isInShelterStayStatus(o.current_stay?.status))
							.map((o) => o._id),
						volunteers: volunteers
							.filter((v) => v.checked_in && v.current_shelter_code === code)
							.map((v) => ({ id: v._id, userName: v.user_name })),
						staffNames: staff.map((u) => u.name).filter((name) => !linkedUserNames.has(name))
					})
				];
				return { ...counts, total: totalShelterPeople(counts), recipientKeys };
			}
		};
	});
