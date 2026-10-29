import { requireManager } from '$lib/guards/auth';
import {
	getShelterReadinessRepository,
	type ShelterReadinessAssessmentDoc
} from '$lib/features/shelter-readiness';
import type { PageLoad } from './$types';

export const load = (async ({ params, fetch }) => {
	const shelterCode = params.id;
	await requireManager(fetch, shelterCode);
	let initialAssessments: ShelterReadinessAssessmentDoc[] = [];
	try {
		const repo = getShelterReadinessRepository();
		initialAssessments = await repo.listAssessments(shelterCode);
	} catch (e) {
		console.warn('[ReadinessPageLoad] Could not load initial assessments:', e);
	}

	return {
		shelterCode,
		initialAssessments
	};
}) satisfies PageLoad;
