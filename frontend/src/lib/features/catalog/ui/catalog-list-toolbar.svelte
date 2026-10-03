<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';

	let {
		total,
		search = $bindable(''),
		canWrite,
		onadd,
		addLabel = 'เพิ่มข้อมูล',
		filters
	}: {
		total: number;
		search?: string;
		canWrite: boolean;
		onadd: () => void;
		addLabel?: string;
		filters?: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
	<h2 class="text-lg font-bold text-foreground">
		รายการข้อมูล (<span class="tabular-nums">{total}</span>)
	</h2>
	<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
		{#if filters}
			{@render filters()}
		{/if}
		<div class="relative w-full sm:w-64">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value={search}
				type="search"
				placeholder="ค้นหา..."
				aria-label="ค้นหา"
				class="h-11 pl-9 sm:h-10"
			/>
		</div>
		{#if canWrite}
			<Button onclick={onadd} class="flex h-11 w-full items-center gap-2 sm:h-10 sm:w-auto">
				<Plus class="size-4" />
				{addLabel}
			</Button>
		{/if}
	</div>
</div>
