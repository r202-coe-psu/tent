<script lang="ts">
	import BackofficeNavbar from '$lib/components/backoffice-navbar.svelte';
	import type { LayoutProps } from './$types';
	import { backofficeNavbarGroups, isGroup } from '$lib/components/backoffice-navbar/static';
	import { page } from '$app/state';
	import { backofficeState } from '$lib/stores/backoffice.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { shouldShowDailySopReconnect } from '$lib/features/daily-sop';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import Building from '@lucide/svelte/icons/building';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { ReauthDialog } from '$lib/features/login';

	let { children }: LayoutProps = $props();
	let reauthOpen = $state(false);

	// Find the current page info (label, icon) dynamically
	const currentPageNode = $derived.by(() => {
		let currentPath = page.url.pathname;
		if (currentPath.startsWith('/back-office/households')) {
			currentPath = '/back-office/evacuee-management';
		}
		// Reached from the ticket queue ("จัดการ"), not the kitchen overview — keep
		// the header label matching where the user came from, not the /kitchen prefix.
		if (currentPath.startsWith('/back-office/kitchen/receive-stock')) {
			currentPath = '/back-office/tickets/kitchen';
		}
		// Ticket detail (/back-office/tickets/{id}) has no nav entry of its own —
		// it's a drill-down from the kitchen ticket queue, so it should keep that
		// queue's header label instead of falling back to the generic default.
		if (
			currentPath.startsWith('/back-office/tickets/') &&
			!currentPath.startsWith('/back-office/tickets/kitchen')
		) {
			currentPath = '/back-office/tickets/kitchen';
		}
		for (const group of backofficeNavbarGroups) {
			for (const item of group.items) {
				if (isGroup(item)) {
					for (const child of item.children) {
						if (child.href && currentPath.startsWith(child.href)) {
							return child;
						}
					}
				} else {
					if (item.href && currentPath.startsWith(item.href)) {
						return item;
					}
				}
			}
		}
		return null;
	});

	const pageTitle = $derived(currentPageNode?.label ?? 'ระบบส่วนหลัง (Back-Office)');
	const PageIcon = $derived(currentPageNode?.icon ?? Building);
	const isDailySopPage = $derived(page.url.pathname.startsWith('/back-office/dailysop'));

	const showStatusBanner = $derived(
		endpointStore.status === 'disconnected' || backofficeState.isOffline
	);

	$effect(() => {
		if (!backofficeState.reauthRequested) return;
		reauthOpen = true;
		backofficeState.clearReauthRequest();
	});

	async function retryDailySopConnection(): Promise<void> {
		await endpointStore.forceRetry();
	}
</script>

<!--
  Shell conventions (Phase 0/1):
  - Sidebar breakpoint: lg (matches system-management; md–lg was a broken half-row).
  - Sticky stack: mobile nav → page header (top: --bo-mobile-nav-height) → content.
  - Page header is title-only (h-16 / 4rem). Shelter select lives in the sidebar / Sheet.
  - Status banner appears only when offline or session needs reauth (not always-on Online).
  - Subheaders under this chrome: top-[var(--bo-sticky-top)] (see app.css).
  - Page padding on children: prefer p-4 sm:p-6; touch targets min-h-11.
-->
<div class="flex w-full flex-1 flex-col items-stretch bg-muted/30 text-foreground lg:flex-row">
	<BackofficeNavbar />
	<div class="flex w-full min-w-0 flex-1 flex-col">
		<!-- Sticky under mobile hamburger bar (< lg); flush top when sidebar is visible -->
		<header
			class="sticky top-[var(--bo-mobile-nav-height)] z-30 flex shrink-0 flex-col border-b border-sidebar-border bg-card lg:top-0"
		>
			<div class="flex h-16 min-h-16 items-center gap-2 px-4 sm:px-6">
				<PageIcon class="size-4 shrink-0 text-primary" />
				<h1 class="truncate text-sm font-bold text-foreground">{pageTitle}</h1>
			</div>

			{#if showStatusBanner}
				<div
					class="flex min-h-11 flex-wrap items-center gap-2 border-t border-warning-border/40 bg-warning/10 px-4 py-2 sm:px-6"
					role="status"
				>
					{#if backofficeState.isOffline}
						<button
							type="button"
							class="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-warning-border/40 bg-warning/15 px-2.5 py-1 text-2xs font-bold text-warning-muted hover:bg-warning/25"
							onclick={() => (reauthOpen = true)}
						>
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-warning"></span>
							Session หมดอายุ — เข้าสู่ระบบอีกครั้ง
						</button>
					{:else}
						<span
							class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-warning-border/40 bg-warning/15 px-2.5 py-1 text-2xs font-bold text-warning-muted"
						>
							<span class="size-1.5 rounded-full bg-warning"></span>
							Offline — ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้
						</span>
						{#if isDailySopPage && shouldShowDailySopReconnect(endpointStore.status)}
							<button
								type="button"
								class="inline-flex h-11 min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-sidebar-border bg-card px-2.5 text-2xs font-bold text-foreground shadow-sm hover:bg-muted sm:px-3 sm:text-xs"
								onclick={retryDailySopConnection}
								aria-label="ตรวจสอบการเชื่อมต่อและซิงค์ข้อมูลอีกครั้ง"
							>
								<RotateCcw class="size-3.5" />
								<span class="hidden sm:inline">ลองเชื่อมต่ออีกครั้ง</span>
								<span class="sm:hidden">ลองใหม่</span>
							</button>
						{/if}
					{/if}
				</div>
			{/if}
		</header>

		<!-- Content grows with the document; window scroll is the primary scroller. -->
		<div class="flex flex-1 flex-col">
			<!-- Reset scoped pages when the navbar changes shelter so every query/form
			     is recreated with the newly selected shelter context. -->
			{#key shelterStore.selectedShelterCode}
				{@render children()}
			{/key}
		</div>
	</div>
</div>

<ReauthDialog bind:open={reauthOpen} />
