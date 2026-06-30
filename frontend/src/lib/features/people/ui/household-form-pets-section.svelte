<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	import type { SuperForm } from 'sveltekit-superforms';

	let {
		form,
		dogCount = $bindable(),
		catCount = $bindable(),
		birdCount = $bindable(),
		otherCount = $bindable()
	}: {
		form: SuperForm<any>;
		dogCount: number;
		catCount: number;
		birdCount: number;
		otherCount: number;
	} = $props();
</script>

<Form.Field {form} name="pets">
	<Form.Control>
		{#snippet children({ props })}
			<Form.Label class="flex items-center gap-1.5">
				<PawPrint class="size-3.5 text-muted-foreground" />
				สัตว์เลี้ยง
			</Form.Label>
			<div {...props} class="mt-1 grid grid-cols-2 gap-2.5">
				{#each [
					{ label: '🐶 สุนัข', i: 0 },
					{ label: '🐱 แมว', i: 1 },
					{ label: '🐦 นก', i: 2 },
					{ label: '🐾 อื่นๆ', i: 3 }
				] as pet (pet.i)}
					<div class="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
						<span class="text-sm font-medium">{pet.label}</span>
						{#if pet.i === 0}
							<Input type="number" min="0" bind:value={dogCount} class="h-8 w-16 px-1 text-center" />
						{:else if pet.i === 1}
							<Input type="number" min="0" bind:value={catCount} class="h-8 w-16 px-1 text-center" />
						{:else if pet.i === 2}
							<Input type="number" min="0" bind:value={birdCount} class="h-8 w-16 px-1 text-center" />
						{:else}
							<Input type="number" min="0" bind:value={otherCount} class="h-8 w-16 px-1 text-center" />
						{/if}
					</div>
				{/each}
			</div>
		{/snippet}
	</Form.Control>
	<Form.FieldErrors />
</Form.Field>
