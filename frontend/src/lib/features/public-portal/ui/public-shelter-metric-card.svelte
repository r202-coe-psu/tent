<script lang="ts">
	import type { Component } from 'svelte';
	import Card from '$lib/components/ui/card/card.svelte';

	let {
		title,
		value,
		unit,
		icon: IconComponent,
		iconClass = 'bg-muted text-muted-foreground'
	}: {
		title: string;
		value: string | number;
		unit: string;
		icon: Component;
		iconClass?: string;
	} = $props();
</script>

<Card
	class="items-center rounded-2xl border-border p-4 shadow-sm transition-all hover:shadow-md sm:p-5"
>
	<div
		class="flex w-full flex-col items-center gap-3 text-center sm:flex-row sm:gap-6 sm:text-left"
	>
		<div
			class="flex size-12 shrink-0 items-center justify-center rounded-xl border-2 shadow-lg sm:size-14 {iconClass}"
		>
			<IconComponent class="size-5 sm:size-6" />
		</div>
		<div class="flex flex-col items-center sm:items-start">
			<p class="text-xs font-medium text-muted-foreground sm:text-sm">{title}</p>
			<p class="mt-0.5 text-xl font-bold text-foreground sm:mt-1 sm:text-2xl">
				{value} <span class="text-xs font-normal text-muted-foreground sm:text-sm">{unit}</span>
			</p>
		</div>
	</div>
</Card>
