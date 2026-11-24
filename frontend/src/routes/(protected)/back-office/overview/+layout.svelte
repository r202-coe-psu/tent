<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Users from '@lucide/svelte/icons/users';
	import Utensils from '@lucide/svelte/icons/utensils';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ label: 'ภาพรวมผู้อพยพ', path: '/back-office/overview/evacuees', icon: Users },
		{ label: 'ภาพรวมการแจกจ่ายอาหาร', path: '/back-office/overview/food', icon: Utensils }
	] as const;

	const isActive = (path: string) => page.url.pathname.replace(/\/$/, '') === path;
</script>

<!--
  --bo-evacuee-tabs-height: sticky tab strip (pt-4 + min-h-11 tabs ≈ 3.75rem).
  --bo-evacuee-selection-top: selection bars in page bodies stick under BO chrome + tabs.
-->
<div
	class="flex flex-col"
	style="--bo-evacuee-tabs-height: 3.75rem; --bo-evacuee-selection-top: calc(var(--bo-sticky-top) + var(--bo-evacuee-tabs-height));"
>
	<!-- Tab nav sticks under BO chrome; offset via --bo-sticky-top (app.css). -->
	<div
		class="sticky top-[var(--bo-sticky-top)] z-20 border-b border-border bg-background px-4 pt-4 sm:px-6"
	>
		<nav class="-mx-1 flex gap-1 overflow-x-auto px-1">
			{#each tabs as tab (tab.path)}
				{@const active = isActive(tab.path)}
				<a
					href={resolve(tab.path)}
					aria-current={active ? 'page' : undefined}
					class="flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-medium transition-colors
						{active
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<tab.icon class="h-4 w-4" />
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>

	<!-- Page content scrolls with the document -->
	<div class="[scrollbar-gutter:stable]">
		{@render children()}
	</div>
</div>
