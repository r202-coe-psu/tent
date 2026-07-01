<script lang="ts">
	import type { Component } from 'svelte';
	import Card from './ui/card/card.svelte';

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
		icon: Component<any>;
		iconClass?: string;
	} = $props();
</script>

<Card class=" items-center rounded-2xl border-border shadow-xs transition-all hover:shadow-md p-5">
	<div class="flex items-center gap-6 w-full">
		<div class="flex size-14 shadow-lg border-2 shrink-0 items-center justify-center rounded-xl {iconClass}">
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
