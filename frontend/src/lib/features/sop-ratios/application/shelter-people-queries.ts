import { createQuery } from '@tanstack/svelte-query';
import { countShelterPeople, totalShelterPeople } from '$lib/features/shared';
import { peopleRepository } from '$lib/features/people';
import { volunteerRepositoryFor } from '$lib/features/volunteers';
import { listShelterStaff } from '$lib/features/users';

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
				return { ...counts, total: totalShelterPeople(counts) };
			}
		};
	});
