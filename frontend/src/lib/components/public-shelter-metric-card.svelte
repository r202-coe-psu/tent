<script lang="ts">
	import type { Component } from 'svelte';
	import * as Card from '$lib/components/ui/card';

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

<Card.Root class="flex items-center gap-4 rounded-2xl border-border shadow-xs transition-all hover:shadow-md p-5">
	<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl {iconClass}">
		<IconComponent class="h-6 w-6" />
	</div>
	<div>
		<p class="text-sm font-medium text-muted-foreground">{title}</p>
		<p class="mt-1 text-2xl font-bold text-foreground">
			{value} <span class="text-sm font-normal text-muted-foreground">{unit}</span>
		</p>
	</div>
</Card.Root>
