<script lang="ts">
	import type { Component } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	/** One shelter count on the `/shelters` map: icon, number and label in a small floating pill. */
	let {
		label,
		value,
		icon: Icon,
		iconClass
	}: {
		label: string;
		value: string | number;
		icon: Component;
		iconClass?: ClassValue;
	} = $props();
</script>

<div
	class="pointer-events-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-card/95 px-2.5 text-xs shadow-md backdrop-blur-md"
>
	<Icon class={['size-3.5 shrink-0', iconClass]} aria-hidden="true" />
	<span class="font-bold text-foreground tabular-nums">{value}</span>
	<span class="whitespace-nowrap text-muted-foreground">{label}</span>
</div>
