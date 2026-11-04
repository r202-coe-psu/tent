<script lang="ts">
	/** Test fixture: the same clock + filter wiring `job-applicants-tab.svelte` uses. */
	import { buildApplicantBoard } from '../domain/applicant-board';
	import { EMPTY_APPLICANT_FILTERS, filterApplicantBoard } from '../domain/applicant-filter';
	import type { ShiftAssignment } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import { todayDateString } from '../application/queries';
	import { createMinuteClock } from './minute-clock.svelte';

	let {
		assignments,
		volunteers
	}: { assignments: ShiftAssignment[]; volunteers: Map<string, Volunteer> } = $props();

	const { now } = createMinuteClock();
	const today = $derived(todayDateString(now));
	const board = $derived(
		buildApplicantBoard({ jobId: 'job:A', applications: [], assignments, volunteers })
	);
	const view = $derived(
		filterApplicantBoard(
			board,
			{ ...EMPTY_APPLICANT_FILTERS, attendance: 'awaiting_confirmation' },
			{ assignments, volunteers, today, now }
		)
	);
</script>

<p data-testid="today">{today}</p>
<p data-testid="awaiting">{view.history.length}</p>
