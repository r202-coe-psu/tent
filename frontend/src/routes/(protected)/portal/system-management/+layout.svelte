<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';
	import {
		systemManagementNavbarGroups,
		isGroup
	} from '$lib/components/system-management-navbar/static';
	import SystemManagementNavbar from '$lib/components/system-management-navbar.svelte';
	import Building from '@lucide/svelte/icons/building';

	let { children }: LayoutProps = $props();

	const currentPageNode = $derived.by(() => {
		const currentPath = page.url.pathname;
		for (const group of systemManagementNavbarGroups) {
			for (const item of group.items) {
				if (isGroup(item)) {
					for (const child of item.children) {
						if (child.href && currentPath.startsWith(child.href)) return child;
					}
				} else if (item.href && currentPath.startsWith(item.href)) {
					return item;
				}
			}
		}
		return null;
	});

	const pageTitle = $derived(currentPageNode?.label ?? 'ทะเบียนพื้นที่และศูนย์พักพิง');
	const PageIcon = $derived(currentPageNode?.icon ?? Building);
</script>

<div
	class="flex min-h-0 w-full flex-1 flex-col items-stretch overflow-hidden bg-muted/30 text-foreground md:flex-row"
>
	<SystemManagementNavbar />
	<div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
		<header
			class="flex h-16 shrink-0 flex-col justify-center border-b border-sidebar-border bg-card px-4 md:px-6"
		>
			<div class="flex items-center justify-between gap-4">
				<div class="flex items-center gap-2">
					<PageIcon class="size-4 shrink-0 text-primary" />
					<h1 class="text-sm font-bold text-foreground">{pageTitle}</h1>
				</div>

				<div class="flex items-center gap-2 md:gap-3">
					<span
						class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
						Online
					</span>
				</div>
			</div>
		</header>

		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{@render children()}
		</div>
	</div>
</div>
