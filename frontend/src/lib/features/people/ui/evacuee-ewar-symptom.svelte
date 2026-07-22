<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { EWAR_SYMPTOM_GROUPS } from '../domain/people';
	import type { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';

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
			toast.error('กรุณาเลือกอาการที่พบ หรือระบุว่า "ไม่มีอาการ" ก่อนดำเนินการต่อ');
			return;
		}
		onNext();
	}
</script>

<div class="space-y-4">
	<!-- Isolation Needed alert card -->
	{#if needsIsolation}
		<div
			class="flex animate-in items-center gap-3 rounded-xl border border-red-600 bg-red-600 p-4 text-white shadow-lg duration-300 fade-in slide-in-from-top-2"
			role="alert"
		>
			<ShieldAlert class="size-7 shrink-0" aria-hidden="true" />
			<div>
				<p class="text-base leading-snug font-bold">
					ระวัง! ต้องส่งไปยังโซนกักกันโรคด่วน <span class="font-extrabold">(ISOLATION NEEDED)</span>
				</p>
				<p class="mt-0.5 text-sm font-medium opacity-90">
					พบอาการกลุ่มเสี่ยงโรคระบาด ให้ดำเนินการย้ายไปยังโซนกักกันโรคทันที และทำรายการต่อ
				</p>
			</div>
		</div>
	{/if}

	<!-- Healthy toggle -->
	<Button
		type="button"
		variant="outline"
		onclick={toggleHealthy}
		class="h-auto w-full rounded-xl border-2 p-4 text-center font-semibold transition-colors {isHealthy
			? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50'
			: 'border-border bg-muted/30 text-muted-foreground hover:border-green-400 hover:bg-green-50/50'}"
	>
		{isHealthy ? '✅' : '🟩'} ไม่มีอาการป่วย (Healthy / No Symptoms)
	</Button>
	{#if isHealthy}
		<div class="flex items-center justify-end pt-6">
			<Button type="button" onclick={handleNext} class="h-10 px-6 text-sm font-semibold">
				ถัดไป →
			</Button>
		</div>
	{/if}

	<!-- Symptom groups -->
	{#each EWAR_SYMPTOM_GROUPS as group (group.title)}
		<div class="space-y-2">
			<p class="text-sm font-semibold text-foreground">{group.title}</p>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{#each group.symptoms as symptom (symptom.id)}
					<Button
						type="button"
						variant="outline"
						disabled={isHealthy}
						onclick={() => toggleSymptom(symptom.id)}
						class="flex h-auto items-start gap-2 rounded-lg border p-3 text-left text-sm font-normal transition-colors disabled:pointer-events-none disabled:opacity-40 {selectedSymptoms.has(
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
	<div class="flex items-center justify-between border-t border-border pt-6">
		<Button type="button" variant="outline" onclick={onBack} class="h-10 px-6 text-sm font-medium">
			ย้อนกลับ
		</Button>
		<Button type="button" onclick={handleNext} class="h-10 px-6 text-sm font-semibold">
			ถัดไป →
		</Button>
	</div>
</div>
