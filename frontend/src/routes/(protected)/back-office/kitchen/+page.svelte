<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { MealSessionList } from '$lib/features/kitchen';
	import { RecipeTab } from '$lib/features/catalog';

	// Live query subscribers (kitchen + operations) are already registered globally
	// via STAFF_LIVE_QUERY_STARTERS in the (protected) layout — no per-page subscription needed.

	type PrimaryTabKey = 'sessions' | 'recipes';

	const activeTab = $derived<PrimaryTabKey>(
		page.url.searchParams.get('tab') === 'recipes' ? 'recipes' : 'sessions'
	);

	function setTab(tab: PrimaryTabKey) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		if (tab === 'sessions') {
			params.delete('tab');
		} else {
			params.set('tab', tab);
		}
		const qs = params.toString();
		void goto(resolve(`/back-office/kitchen${qs ? `?${qs}` : ''}` as '/back-office/kitchen'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function tabClass(active: boolean) {
		return [
			'-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-[3px] px-3.5 text-base transition-colors focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:outline-none md:px-4',
			active
				? 'border-[var(--brand-primary)] font-bold text-[var(--brand-primary)]'
				: 'border-transparent font-semibold text-muted-foreground hover:text-foreground'
		].join(' ');
	}
</script>

<svelte:head>
	<title
		>{activeTab === 'recipes' ? 'สูตรอาหาร (BOM)' : 'รายการมื้ออาหาร'} · ครัวกลางและอาหาร · SmartShelter</title
	>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-4 bg-[#F8FAFC] p-3.5 sm:gap-6 sm:p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-[var(--brand-primary)] sm:text-3xl">
			ครัวกลางและอาหาร
		</h1>
		<p class="text-base text-muted-foreground sm:text-lg">
			บริหารจัดการเป้าหมายการผลิตอาหารและสูตรอาหารมาตรฐานของศูนย์
		</p>
	</header>

	<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border">
		<nav
			class="flex min-w-0 scrollbar-none items-center gap-1 overflow-x-auto"
			aria-label="แท็บครัว"
		>
			<button
				type="button"
				onclick={() => setTab('sessions')}
				aria-current={activeTab === 'sessions' ? 'page' : undefined}
				class={tabClass(activeTab === 'sessions')}
			>
				รายการมื้ออาหาร
			</button>
			<button
				type="button"
				onclick={() => setTab('recipes')}
				aria-current={activeTab === 'recipes' ? 'page' : undefined}
				class={tabClass(activeTab === 'recipes')}
			>
				สูตรอาหาร (BOM)
			</button>
		</nav>
	</div>

	{#if activeTab === 'sessions'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<MealSessionList embedded={true} />
		</div>
	{:else if activeTab === 'recipes'}
		<div class="animate-in duration-300 fade-in slide-in-from-bottom-2">
			<RecipeTab basePath="/back-office/kitchen" />
		</div>
	{/if}
</div>
