<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import { summarizeConsent, type EvacueeConsent } from '../domain/consent';
	import type { ConsentStaff } from '../application/consent-block.svelte';

	let {
		consent,
		searchExcluded,
		guardianNames = [],
		staff = null,
		heading
	}: {
		consent: EvacueeConsent;
		/** The person's current `privacy.search_excluded`. */
		searchExcluded: boolean;
		guardianNames?: readonly string[];
		staff?: ConsentStaff | null;
		/** Replaces the §5 title, e.g. with the person's name on a read-only report-in summary. */
		heading?: string;
	} = $props();

	const uid = $props.id();
	const summary = $derived(summarizeConsent(consent, searchExcluded, { guardianNames, staff }));
</script>

<section
	aria-labelledby="{uid}-title"
	class="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5"
>
	<h3 id="{uid}-title" class="text-base font-semibold text-slate-800">
		{heading ?? summary.title}
	</h3>
	<dl class="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
		{#each summary.rows as row (row.key)}
			<dt class="font-semibold text-slate-500">{row.label}</dt>
			<dd
				class={[
					'text-slate-900',
					row.mono && 'tabular-nums',
					row.key === 'ref' && 'font-mono tracking-wide'
				]}
			>
				{#if row.consented === true}
					<span class="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
						<CircleCheck class="size-4" aria-hidden="true" />{row.value}
					</span>
				{:else if row.consented === false}
					<span class="inline-flex items-center gap-1.5 font-semibold text-red-800">
						<CircleX class="size-4" aria-hidden="true" />{row.value}
					</span>
				{:else}
					{row.value}
				{/if}
			</dd>
		{/each}
	</dl>
	<p class="text-sm text-slate-500">{summary.footer}</p>
</section>
