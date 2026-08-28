<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { EWAR_SYMPTOM_GROUPS } from '../domain/people';
	import type { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { EVACUEE_EWAR_I18N } from './_constants/evacuee-ewar.i18n';

	let {
		onNext,
		onBack,
		selectedSymptoms,
		isHealthy = $bindable(false)
	}: {
		onNext: () => void;
		onBack: () => void;
		selectedSymptoms: SvelteSet<string>;
		isHealthy: boolean;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_EWAR_I18N, languageStore.current));

	function toggleSymptom(id: string) {
		if (isHealthy) return;
		if (selectedSymptoms.has(id)) {
			selectedSymptoms.delete(id);
		} else {
			selectedSymptoms.add(id);
		}
	}

	function toggleHealthy() {
		isHealthy = !isHealthy;
		if (isHealthy) selectedSymptoms.clear();
	}

	// don't warrant isolation on their own.
	const NON_ISOLATION_SYMPTOMS = new Set(['trauma', 'chemical_poisoning', 'tetanus']);

	const needsIsolation = $derived(
		!isHealthy && [...selectedSymptoms].some((id) => !NON_ISOLATION_SYMPTOMS.has(id))
	);

	function handleNext() {
		if (!isHealthy && selectedSymptoms.size === 0) {
			toast.error(t.toastSelectRequired);
			return;
		}
		onNext();
	}
</script>

<div class="space-y-5 sm:space-y-4">
	<!-- Isolation Needed alert card -->
	{#if needsIsolation}
		<div
			class="flex animate-in items-center gap-3 rounded-xl border border-red-600 bg-red-600 p-4 text-white shadow-lg duration-300 fade-in slide-in-from-top-2"
			role="alert"
		>
			<ShieldAlert class="size-7 shrink-0" aria-hidden="true" />
			<div>
				<p class="text-base leading-snug font-bold">
					{t.isolationTitle} <span class="font-extrabold">{t.isolationBadge}</span>
				</p>
				<p class="mt-0.5 text-sm font-medium opacity-90">
					{t.isolationDesc}
				</p>
			</div>
		</div>
	{/if}

	<!-- Healthy toggle -->
	<Button
		type="button"
		variant="outline"
		aria-pressed={isHealthy}
		onclick={toggleHealthy}
		class="h-auto min-h-14 w-full touch-manipulation rounded-xl border-2 p-4 text-center font-semibold transition-colors sm:min-h-12 sm:p-3 {isHealthy
			? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50'
			: 'border-border bg-muted/30 text-muted-foreground hover:border-green-400 hover:bg-green-50/50'}"
	>
		{isHealthy ? '✅' : '🟩'}
		{t.healthyLabel}
	</Button>

	<!-- Symptom groups -->
	{#each EWAR_SYMPTOM_GROUPS as group (group.title)}
		<div class="space-y-2.5 sm:space-y-2">
			<p class="text-sm font-semibold text-foreground">{group.title}</p>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2 lg:grid-cols-3">
				{#each group.symptoms as symptom (symptom.id)}
					<Button
						type="button"
						variant="outline"
						disabled={isHealthy}
						aria-pressed={selectedSymptoms.has(symptom.id)}
						onclick={() => toggleSymptom(symptom.id)}
						class="flex h-auto min-h-14 w-full touch-manipulation items-center gap-3 rounded-lg border p-4 text-left text-sm font-normal transition-colors disabled:pointer-events-none disabled:opacity-40 sm:min-h-11 sm:gap-2 sm:p-3 {selectedSymptoms.has(
							symptom.id
						)
							? 'border-primary bg-primary/10 text-foreground hover:bg-primary/15'
							: 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5'}"
					>
						<span class="text-lg leading-none">{symptom.emoji}</span>
						<span class="leading-snug whitespace-normal">
							{symptom.label}
						</span>
					</Button>
				{/each}
			</div>
		</div>
	{/each}

	<!-- Back + Next row -->
	<div
		class="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:items-center sm:justify-between"
	>
		<Button
			type="button"
			onclick={handleNext}
			class="h-12 w-full px-6 text-sm font-semibold sm:h-10 sm:w-auto"
		>
			{t.next}
		</Button>
		<Button
			type="button"
			variant="outline"
			onclick={onBack}
			class="h-12 w-full px-6 text-sm font-medium sm:h-10 sm:w-auto"
		>
			{t.back}
		</Button>
	</div>
</div>
