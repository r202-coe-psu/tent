<script lang="ts">
	import type { Component } from 'svelte';
	import Siren from '@lucide/svelte/icons/siren';
	import Loader from '@lucide/svelte/icons/loader';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Archive from '@lucide/svelte/icons/archive';
	import Ban from '@lucide/svelte/icons/ban';
	import {
		INCIDENT_STATUSES,
		INCIDENT_STATUS_LABELS,
		type IncidentStatus,
		type IncidentStatusFilter
	} from '../domain/incident';

	let {
		counts,
		active,
		onselect
	}: {
		counts: Record<IncidentStatus, number>;
		active: IncidentStatusFilter;
		onselect: (status: IncidentStatus) => void;
	} = $props();

	const TONE: Record<IncidentStatus, { card: string; number: string; Icon: Component }> = {
		reported: { card: 'border-sky-200', number: 'text-sky-900', Icon: Siren },
		action_in_progress: { card: 'border-amber-200', number: 'text-amber-900', Icon: Loader },
		resolved: { card: 'border-emerald-200', number: 'text-emerald-900', Icon: CircleCheck },
		closed: { card: 'border-slate-200', number: 'text-slate-700', Icon: Archive },
		cancelled: { card: 'border-slate-200', number: 'text-slate-500', Icon: Ban }
	};
</script>

<section aria-label="สรุปจำนวนเคสตามสถานะ" class="grid grid-cols-2 gap-2.5 lg:grid-cols-5 xl:gap-3">
	{#each INCIDENT_STATUSES as status (status)}
		{@const tone = TONE[status]}
		{@const selected = active === status}
		<button
			type="button"
			aria-pressed={selected}
			onclick={() => onselect(status)}
			class="flex min-h-[72px] flex-col justify-center gap-0.5 rounded-xl border bg-white px-3.5 py-2.5 text-left shadow-2xs transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {tone.card} {selected
				? 'bg-slate-50 ring-2 ring-slate-900'
				: ''}"
		>
			<span class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">{INCIDENT_STATUS_LABELS[status]}</span>
				<tone.Icon class="size-4 shrink-0 {tone.number}" aria-hidden="true" />
			</span>
			<span class="text-2xl font-bold tabular-nums {tone.number}">{counts[status]}</span>
		</button>
	{/each}
</section>
