<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		MASTER_DATA_TYPES,
		MASTER_DATA_TYPE_LABELS,
		type MasterDataType
	} from '$lib/features/master-data';

	let {
		activeType,
		counts
	}: {
		activeType: MasterDataType;
		counts: Partial<Record<MasterDataType, number>>;
	} = $props();

	const BASE_PATH = resolve('/back-office/registration-config');

	function navigateToType(type: MasterDataType) {
		// BASE_PATH already uses resolve() above; the query string is the only dynamic part.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${BASE_PATH}?type=${encodeURIComponent(type)}`, { replaceState: true });
	}
</script>

<aside class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
	<h2 class="mb-3 text-sm font-semibold text-muted-foreground">ประเภทพารามิเตอร์มาสเตอร์</h2>
	<nav class="flex flex-col gap-2">
		{#each MASTER_DATA_TYPES as type (type)}
			{@const isActive = type === activeType}
			<button
				type="button"
				onclick={() => navigateToType(type)}
				aria-current={isActive ? 'page' : undefined}
				class="group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition
					{isActive
					? 'border-transparent bg-primary text-primary-foreground shadow'
					: 'border-input bg-background hover:bg-accent'}"
			>
				<div class="flex-1">
					<div class="text-sm leading-tight font-semibold">{MASTER_DATA_TYPE_LABELS[type]}</div>
					<div
						class="mt-1 text-xs {isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}"
					>
						ยังไม่ได้เลือกค่าหลัก
					</div>
				</div>
				<span
					class="flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold
						{isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-foreground'}"
				>
					{counts[type] ?? 0}
				</span>
			</button>
		{/each}
	</nav>
</aside>
