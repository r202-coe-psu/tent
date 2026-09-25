<script lang="ts">
	export type StaffSideNavItem = {
		id: string;
		label: string;
		href?: string;
		onclick?: () => void;
		count?: number;
		description?: string;
	};

	let {
		items,
		activeId,
		sectionLabel = 'ประเภท',
		ariaLabel
	}: {
		items: readonly StaffSideNavItem[];
		activeId: string;
		sectionLabel?: string;
		ariaLabel?: string;
	} = $props();

	const navLabel = $derived(ariaLabel ?? sectionLabel);

	function countLabel(count: number): string {
		return `${count} รายการ`;
	}
</script>

<!-- Desktop sidebar -->
<aside class="hidden w-[200px] shrink-0 border-r border-slate-200/80 bg-white p-3 lg:block">
	<p class="mb-2 px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
		{sectionLabel}
	</p>
	<nav class="flex flex-col gap-1" aria-label={navLabel}>
		{#each items as item (item.id)}
			{@const isActive = item.id === activeId}
			{#if item.href}
				<a
					href={item.href}
					aria-current={isActive ? 'page' : undefined}
					class="block rounded-lg px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{isActive
						? 'border border-sky-200 bg-sky-50 font-semibold text-[#0A2647]'
						: 'border border-transparent hover:bg-slate-50'}"
				>
					<div class="text-sm leading-tight">{item.label}</div>
					{#if item.count !== undefined}
						<div class="mt-0.5 text-xs text-slate-500 tabular-nums">{countLabel(item.count)}</div>
					{:else if item.description}
						<div class="mt-0.5 text-xs text-slate-500">{item.description}</div>
					{/if}
				</a>
			{:else}
				<button
					type="button"
					onclick={() => item.onclick?.()}
					aria-current={isActive ? 'page' : undefined}
					class="block w-full rounded-lg px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{isActive
						? 'border border-sky-200 bg-sky-50 font-semibold text-[#0A2647]'
						: 'border border-transparent hover:bg-slate-50'}"
				>
					<div class="text-sm leading-tight">{item.label}</div>
					{#if item.count !== undefined}
						<div class="mt-0.5 text-xs text-slate-500 tabular-nums">{countLabel(item.count)}</div>
					{:else if item.description}
						<div class="mt-0.5 text-xs text-slate-500">{item.description}</div>
					{/if}
				</button>
			{/if}
		{/each}
	</nav>
</aside>

<!-- Mobile: horizontal chip row -->
<div class="border-b border-slate-200/80 p-3 lg:hidden">
	<nav class="flex gap-2 overflow-x-auto pb-1" aria-label={navLabel}>
		{#each items as item (item.id)}
			{@const isActive = item.id === activeId}
			{#if item.href}
				<a
					href={item.href}
					aria-current={isActive ? 'page' : undefined}
					class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{isActive
						? 'border-sky-200 bg-sky-50 text-[#0A2647]'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
				>
					{item.label}
					{#if item.count !== undefined}
						<span class="text-slate-500 tabular-nums">{item.count}</span>
					{/if}
				</a>
			{:else}
				<button
					type="button"
					onclick={() => item.onclick?.()}
					aria-current={isActive ? 'page' : undefined}
					class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none
						{isActive
						? 'border-sky-200 bg-sky-50 text-[#0A2647]'
						: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
				>
					{item.label}
					{#if item.count !== undefined}
						<span class="text-slate-500 tabular-nums">{item.count}</span>
					{/if}
				</button>
			{/if}
		{/each}
	</nav>
</div>
