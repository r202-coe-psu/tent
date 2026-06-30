<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
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

	function handleNext() {
		if (!isHealthy && selectedSymptoms.size === 0) {
			toast.error('กรุณาเลือกอาการที่พบ หรือระบุว่า "ไม่มีอาการ" ก่อนดำเนินการต่อ');
			return;
		}
		onNext();
	}
</script>

<div class="space-y-4">
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
