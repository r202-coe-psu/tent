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

<Card class=" items-center rounded-2xl border-border p-5 shadow-xs transition-all hover:shadow-md">
	<div class="flex w-full items-center gap-6">
		<div
			class="flex size-14 shrink-0 items-center justify-center rounded-xl border-2 shadow-lg {iconClass}"
		>
			<IconComponent class="size-6" />
		</div>
		<div class="flex flex-col">
			<p class="text-sm font-medium text-muted-foreground">{title}</p>
			<p class="mt-1 text-2xl font-bold text-foreground">
				{value} <span class="text-sm font-normal text-muted-foreground">{unit}</span>
			</p>
		</div>
	</div>
</Card>
