<script lang="ts">
	import BackofficeNavbar from '$lib/components/backoffice-navbar.svelte';
	import type { LayoutProps } from './$types';
	import {
		backofficeNavbarGroups,
		isGroup,
		type BackofficeNavbarNode,
		type BackofficeNavbarLeaf
	} from '$lib/components/backoffice-navbar/static';
	import { page } from '$app/state';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { shouldShowDailySopReconnect } from '$lib/features/daily-sop';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import Building from '@lucide/svelte/icons/building';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { useShelters } from '$lib/features/shelters';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import { Button } from '$lib/components/ui/button';

	let { children }: LayoutProps = $props();

	const sheltersQuery = useShelters();
	const shelters = $derived(sheltersQuery.data ?? []);
	const isZeroShelters = $derived(!sheltersQuery.isLoading && shelters.length === 0);

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	function findMatchingLeaf(
		node: BackofficeNavbarNode,
		currentPath: string
	): BackofficeNavbarLeaf | null {
		if (isGroup(node)) {
			for (const child of node.children) {
				const match = findMatchingLeaf(child, currentPath);
				if (match) return match;
			}
			return null;
		}
		if (node.href && currentPath.startsWith(node.href)) {
			return node;
		}
		return null;
	}
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
				const match = findMatchingLeaf(item, currentPath);
				if (match) return match;
			}
		}
		return null;
	});

	const pageTitle = $derived(currentPageNode?.label ?? 'ระบบส่วนหลัง');
	const PageIcon = $derived(currentPageNode?.icon ?? Building);
	const isDailySopPage = $derived(page.url.pathname.startsWith('/back-office/dailysop'));

	/** Offline only — session expiry is the global login modal, never this banner. */
	const showStatusBanner = $derived(endpointStore.status === 'disconnected');

	async function retryDailySopConnection(): Promise<void> {
		await endpointStore.forceRetry();
	}
</script>

<!--
  Shell conventions (Phase 0/1):
  - Sidebar breakpoint: lg (matches system-management; md–lg was a broken half-row).
  - Sticky stack: mobile nav → page header (top: --bo-mobile-nav-height) → content.
  - Page header is title-only (h-16 / 4rem). Shelter select lives in the sidebar / Sheet.
  - Status banner appears only when offline (session expiry is the global login modal).
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
				</div>
			{/if}
		</header>

		<!-- Content grows with the document; window scroll is the primary scroller. -->
		<div class="flex flex-1 flex-col">
			{#if isZeroShelters}
				<div class="flex flex-1 items-center justify-center p-6 sm:p-12">
					<div
						class="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-slate-200/80 bg-card p-8 text-center shadow-xs"
					>
						<div
							class="mb-4 flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-8 ring-amber-50/50"
						>
							<ShieldAlert class="size-7" />
						</div>
						<h2 class="text-xl font-bold text-foreground sm:text-2xl">ยังไม่มีศูนย์พักพิงในระบบ</h2>
						<p class="mt-2 text-sm leading-relaxed text-muted-foreground">
							การดำเนินการในระบบส่วนหลังจำเป็นต้องมีศูนย์พักพิงที่เปิดใช้งานอย่างน้อย 1 แห่งในระบบ
						</p>
						{#if isSA}
							<div class="mt-6 flex w-full flex-col items-center gap-3">
								<Button
									href="/system-management/shelters"
									size="lg"
									class="w-full px-6 font-semibold sm:w-auto"
								>
									สร้างหรือนำเข้าศูนย์พักพิง
								</Button>
								<p class="text-xs text-muted-foreground">
									ไปที่หน้าจัดการศูนย์พักพิงเพื่อสร้างศูนย์ใหม่หรือนำเข้าข้อมูล
								</p>
							</div>
						{:else}
							<div
								class="mt-6 w-full rounded-xl border border-border bg-muted/50 p-4 text-xs text-muted-foreground"
							>
								กรุณาติดต่อผู้ดูแลระบบ (System Administrator)
								เพื่อสร้างหรือเปิดใช้งานศูนย์พักพิงในระบบ
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<!-- Reset scoped pages when the navbar changes shelter so every query/form
				     is recreated with the newly selected shelter context. -->
				{#key shelterStore.selectedShelterCode}
					{@render children()}
				{/key}
			{/if}
		</div>
	</div>
</div>
