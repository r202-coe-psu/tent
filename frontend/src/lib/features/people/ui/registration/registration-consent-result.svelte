<script lang="ts">
	import { ConsentSummary, type ConsentStaff } from '$lib/features/consent';
	import type { Evacuee } from '../../domain/people';

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
</script>

{#if subject?.consent}
	<div class="mb-4 print:hidden">
		<ConsentSummary
			consent={subject.consent}
			searchExcluded={subject.privacy.search_excluded}
			{staff}
		/>
	</div>
{/if}
