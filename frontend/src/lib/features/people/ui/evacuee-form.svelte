<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import type { EvacueeInput } from '../domain/people';
	import SearchSection from './evacuee-search.svelte';
	import EwarSymptomSection from './evacuee-ewar-symptom.svelte';
	import RegistrationSection from './evacuee-registration.svelte';

	let {
		onsubmit,
		pending = false,
		step = $bindable(1)
	}: { onsubmit: (input: EvacueeInput, symptoms: string[]) => void; pending?: boolean; step?: 1 | 2 | 3 } = $props();

	let selectedSymptoms = $state(new SvelteSet<string>());
	let isHealthy = $state(false);

	function handleRegistrationSubmit(input: EvacueeInput) {
		onsubmit(input, Array.from(selectedSymptoms));
		selectedSymptoms.clear();
		isHealthy = false;
		step = 1;
	}
</script>

<!-- ── Step indicator ─────────────────────────────────────────────────────────── -->
<div class="mb-6 flex items-center gap-3">
	{#each [1, 2, 3] as s (s)}
		<div class="flex items-center gap-2">
			<div
				class="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
				s
					? 'bg-primary text-primary-foreground'
					: step > s
						? 'bg-green-600 text-white'
						: 'bg-muted text-muted-foreground'}"
			>
				{step > s ? '✓' : s}
			</div>
			<span class="text-sm font-medium {step === s ? 'text-foreground' : 'text-muted-foreground'}">
				{s === 1 ? 'ตรวจสอบประวัติ' : s === 2 ? 'ประเมินอาการ (EWAR)' : 'ข้อมูลผู้ประสบภัย'}
			</span>
		</div>
		{#if s < 3}
			<div class="h-px flex-1 bg-border hidden sm:block"></div>
		{/if}
	{/each}
</div>

{#if step === 1}
	<SearchSection onNext={() => (step = 2)} />
{:else if step === 2}
	<EwarSymptomSection
		bind:isHealthy
		{selectedSymptoms}
		onNext={() => (step = 3)}
	/>
{:else if step === 3}
	<RegistrationSection
		onsubmit={handleRegistrationSubmit}
		{pending}
		onBack={() => (step = 2)}
	/>
{/if}
