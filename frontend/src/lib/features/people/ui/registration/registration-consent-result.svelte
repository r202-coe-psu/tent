<script lang="ts">
	import { ConsentSummary, type ConsentStaff } from '$lib/features/consent';
	import { formatPersonName, type Evacuee } from '../../domain/people';

	let {
		members,
		consentRef,
		staff = null
	}: {
		members: Evacuee[];
		consentRef: string;
		staff?: ConsentStaff | null;
	} = $props();

	const recorded = $derived(members.filter((m) => m.consent?.ref === consentRef));
	const subject = $derived(
		recorded.find((m) => m.consent?.given_by === 'self') ?? recorded[0] ?? null
	);
	const guardianNames = $derived(
		recorded.filter((m) => m.consent?.given_by === 'guardian').map((m) => formatPersonName(m))
	);
</script>

{#if subject?.consent}
	<div class="mb-4 print:hidden">
		<ConsentSummary
			consent={subject.consent}
			searchExcluded={subject.privacy.search_excluded}
			{guardianNames}
			{staff}
		/>
	</div>
{/if}
