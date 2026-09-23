import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { Evacuee } from '../../domain/people';

/** Station 1 queue → full-page report-in form (valid only for `pre_registered` docs). */
export function goToEvacueeReportIn(evacuee: Evacuee): void {
	goto(resolve(`/onsite/people/${evacuee._id}/report-in` as `/onsite/people/${string}/report-in`));
}

/** Station 1 queue → evacuee profile, preserving the originating list for the back link. */
export function goToEvacueeProfile(evacuee: Evacuee, from?: string): void {
	const search = from ? `?from=${encodeURIComponent(from)}` : '';
	goto(
		resolve(
			`/onsite/people/evacuee-profile-view/${evacuee._id}${search}` as `/onsite/people/evacuee-profile-view/${string}`
		)
	);
}

/**
 * Row entry point shared by the Station 1 queue and the search-edit list:
 * `pre_registered` opens the report-in form directly; every other stay status opens
 * the profile instead, because report-in rejects non-`pre_registered` docs.
 */
export function openEvacueeRow(evacuee: Evacuee, from?: string): void {
	if (evacuee.current_stay?.status === 'pre_registered') {
		goToEvacueeReportIn(evacuee);
		return;
	}
	goToEvacueeProfile(evacuee, from);
}
