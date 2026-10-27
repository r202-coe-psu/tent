<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import NeedsBoardAdmin from '$lib/components/needs-board-admin.svelte';
	import PendingReviewBoard from '$lib/components/pending-review-board.svelte';
	import PendingReviewDetail from '$lib/components/pending-review-detail.svelte';
	import ReceivedDonationsList from './components/received-donations-list.svelte';
	import ScanStation from './components/scan-station.svelte';
	import CreateCampaignForm from './components/create-campaign-form.svelte';
	import EditCampaignForm from './components/edit-campaign-form.svelte';
	import ForceCutoffDialog from './components/force-cutoff-dialog.svelte';
	import DonationSlotsManager from './components/donation-slots-manager.svelte';
	import { useDonationNeedsBoard, type NeedItem } from '$lib/features/operations';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { resolveShelterCode } from '$lib/db/shelter';
	import { Button } from '$lib/components/ui/button/index.js';
	import User from '@lucide/svelte/icons/user';
	import {
		donationActionRef,
		donationQueueKeys,
		filterForLegacyTab,
		parseQueueFilter,
		queueGroupOf,
		useDonationQueue,
		useReceivedDonations,
		type DonationQueueFilter,
		type LineReviewDecision,
		type PendingDonationRow,
		type RejectDonationInput
	} from '$lib/features/donations';

	/**
	 * Tabs: `list | needs | slots`.
	 *
	 * `list` — "รายการของบริจาค" (#617) — replaced the scan and review tabs, which showed
	 * largely the same bookings: everything waiting for review or for drop-off, one list
	 * with a status filter, the scanner and walk-in at its top right. The old `?tab=scan`
	 * and `?tab=pending` links still land here, on the matching filter.
	 *
	 * Two older tabs were taken off on 2026-09-01 (D-11 / D-9) — **กำลังตรวจรับ** (the
	 * drop-off queue, now part of this list) and **ส่งต่อเข้ามา** (read-only, with no
	 * way yet to turn a `donation_redirect` into stock). Their boards still exist
	 * (`verifying-board.svelte`, `incoming-redirects-board.svelte`).
	 */
	const TABS = ['list', 'needs', 'slots'] as const;
	type TabKey = (typeof TABS)[number];

	// The tab lives in `?tab=`, not in component state: the back-office layout remounts
	// this page on every shelter switch (`{#key selectedShelterCode}`), which used to
	// throw staff back to the first tab mid-task. The list filter rides along in `?filter=`.
	const requestedTab = $derived(page.url.searchParams.get('tab'));
	const activeSubTab = $derived<TabKey>(TABS.find((t) => t === requestedTab) ?? 'list');
	const queueFilter = $derived<DonationQueueFilter>(
		parseQueueFilter(page.url.searchParams.get('filter') ?? filterForLegacyTab(requestedTab))
	);
	let viewState = $state<'list' | 'create' | 'edit'>('list');
	// One board row = one need, so the edit target is (campaign, item), never just the campaign.
	let selectedEditingItem = $state<NeedItem | null>(null);
	let selectedEditingItemId = $state('');

	const needsBoard = useDonationNeedsBoard({
		onFormCreated: () => {
			viewState = 'list';
		}
	});

	/**
	 * T-22 / CR-052 §1.6 — closing a need by hand needs a reason, reopening does not.
	 * `NeedsBoardAdmin` is shared with other screens and hands the action up as a prop, so
	 * the prompt is intercepted here rather than inside the board.
	 */
	let cutOffTarget = $state<{ id: string; itemId: string; name: string } | null>(null);

	function handleToggleCutOff(id: string, itemId: string) {
		const need = needsBoard.derivedItems
			.find((i) => i.id === id)
			?.needs.find((n) => n.itemId === itemId);
		if (need?.isManualClosed) {
			needsBoard.toggleCutOff(id, itemId);
			return;
		}
		cutOffTarget = { id, itemId, name: need?.name ?? itemId };
	}

	// The booking list (#617) — loaded at mount, not on first click: the tab badge is the
	// only signal that something waits for review.
	const queryClient = useQueryClient();
	const queue = useDonationQueue();
	const queueRows = $derived(queue.data ?? []);
	const pendingCount = $derived(
		queueRows.filter((row) => queueGroupOf(row.status) === 'pending').length
	);
	// "รับแล้ว" (#821) — fetched only while that filter is open, for the shelter the page
	// works in. Never part of `queueRows`, so "ทั้งหมด" and the badge stay the open queue.
	const receivedQuery = useReceivedDonations(
		() => resolveShelterCode() ?? '',
		() => activeSubTab === 'list' && queueFilter === 'received'
	);
	const receivedRows = $derived(receivedQuery.data?.pages.flatMap((p) => p.donations) ?? []);
	const refreshQueue = () => queryClient.invalidateQueries({ queryKey: donationQueueKeys.all });

	/** What the list tab shows: the list, a booking under review, or the counter. */
	let selectedPendingRequest = $state<PendingDonationRow | null>(null);
	let station = $state<{ view: 'scan' | 'walkin'; query: string } | null>(null);
	let pendingActionSaving = $state(false);

	function openRow(row: PendingDonationRow) {
		if (row.status === 'received') {
			selectedPendingRequest = row;
			return;
		}
		if (queueGroupOf(row.status) === 'pending') {
			selectedPendingRequest = row;
			return;
		}
		station = { view: 'scan', query: donationActionRef(row) ?? '' };
	}

	/** The donor edited the booking while it was open: close it and show the list again. */
	function staleDecision(message: string) {
		toast.error(message, { duration: 10_000 });
		selectedPendingRequest = null;
		void refreshQueue();
	}

	function setQueueFilter(filter: DonationQueueFilter) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('tab', 'list');
		params.set('filter', filter);
		void goto(resolve(`/back-office/stock-donations?${params}` as '/back-office/stock-donations'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function switchTab(tab: string) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('tab', tab);
		params.delete('filter');
		void goto(resolve(`/back-office/stock-donations?${params}` as '/back-office/stock-donations'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		viewState = 'list';
		selectedPendingRequest = null;
		station = null;
	}

	async function handleApprovePending(
		bookingRef: string,
		memo: string,
		lines?: LineReviewDecision[]
	) {
		if (!bookingRef || pendingActionSaving) return;
		pendingActionSaving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(bookingRef)}/approve`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						memo,
						...(lines ? { lines } : {}),
						expected_rev: selectedPendingRequest?.rev
					})
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(
					data.donation?.status === 'rejected'
						? `ปฏิเสธคำขอ ${bookingRef} แล้ว (ไม่รับทุกรายการ)`
						: `บันทึกผลการประเมิน ${bookingRef} แล้ว — รอผู้บริจาคนำส่ง`
				);
				selectedPendingRequest = null;
				await refreshQueue();
			} else if (data.error_code === 'DONATION_CHANGED') {
				staleDecision(data.error);
			} else {
				toast.error(data.error || 'อนุมัติไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			pendingActionSaving = false;
		}
	}

	async function handleRejectPending(bookingRef: string, input: RejectDonationInput) {
		if (!bookingRef || pendingActionSaving) return;
		pendingActionSaving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(bookingRef)}/reject`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ...input, expected_rev: selectedPendingRequest?.rev })
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(`ปฏิเสธคำขอ ${bookingRef} เรียบร้อยแล้ว`);
				selectedPendingRequest = null;
				await refreshQueue();
			} else if (data.error_code === 'DONATION_CHANGED') {
				staleDecision(data.error);
			} else {
				toast.error(data.error || 'ปฏิเสธไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			pendingActionSaving = false;
		}
	}

	// R-16.4 (CR-087) — writes a `donation_redirect` ticket into the destination
	// shelter's db and closes this one out as `redirected`. No ledger row here.
	async function handleRedirectPending(
		bookingRef: string,
		targetShelterCode: string,
		note: string
	) {
		if (!bookingRef || pendingActionSaving) return;
		pendingActionSaving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(bookingRef)}/redirect`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target_shelter_code: targetShelterCode,
						...(note ? { note } : {}),
						expected_rev: selectedPendingRequest?.rev
					})
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(
					`ส่งต่อคำขอ ${bookingRef} ไปยังศูนย์ ${targetShelterCode} เรียบร้อยแล้ว — ศูนย์ปลายทางจะเห็นคำขอนี้ในคิวของตัวเอง`
				);
				selectedPendingRequest = null;
				await refreshQueue();
			} else if (data.error_code === 'DONATION_CHANGED') {
				staleDecision(data.error);
			} else {
				toast.error(data.error || 'ส่งต่อไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			pendingActionSaving = false;
		}
	}
</script>

<svelte:head>
	<title>กระดานรับบริจาค · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
	<!-- Title with Accent Line — same header treatment as /back-office/supply, so the
	     two halves of the stock domain read as one screen family. -->
	<div class="flex items-center gap-3 border-l-4 border-primary pl-3">
		<h2 class="text-xl font-bold text-foreground">คลังทรัพยากร (Stock &amp; Donations)</h2>
	</div>

	<Tabs.Root value={activeSubTab} onValueChange={switchTab} class="gap-4 md:gap-6">
		<!-- Segmented pills, matching /back-office/supply so the two halves of the stock
		     domain read as one control. Built on the Tabs primitive rather than supply's
		     bare <button>s: identical geometry, but the list keeps its tablist role and
		     arrow-key navigation. -->
		<div class="flex w-full scrollbar-none overflow-x-auto pb-1 sm:pb-0">
			<Tabs.List
				class="inline-flex h-auto min-w-max justify-start rounded-xl border border-border/40 bg-muted/60 p-1 shadow-sm"
			>
				<Tabs.Trigger
					value="list"
					class="flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3.5 py-2 text-xs font-semibold tracking-wide text-muted-foreground transition-all duration-300 hover:text-foreground active:scale-[0.98] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm md:px-5 md:py-2.5"
				>
					<ClipboardList class="h-4 w-4" />
					รายการของบริจาค
					{#if pendingCount > 0}
						<Badge
							class="h-4 min-w-4 bg-amber-500 px-1.5 text-2xs leading-none font-bold text-white"
							aria-label="รอประเมิน {pendingCount} รายการ"
						>
							{pendingCount}
						</Badge>
					{/if}
				</Tabs.Trigger>

				<Tabs.Trigger
					value="needs"
					class="flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3.5 py-2 text-xs font-semibold tracking-wide text-muted-foreground transition-all duration-300 hover:text-foreground active:scale-[0.98] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm md:px-5 md:py-2.5"
				>
					<Megaphone class="h-4 w-4" />
					จัดการความต้องการ
				</Tabs.Trigger>

				<!-- DN-5 — the queue the public wizard books into (schema.md §2.13). -->
				<Tabs.Trigger
					value="slots"
					class="flex shrink-0 items-center gap-2 rounded-lg border border-transparent px-3.5 py-2 text-xs font-semibold tracking-wide text-muted-foreground transition-all duration-300 hover:text-foreground active:scale-[0.98] data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm md:px-5 md:py-2.5"
				>
					<CalendarClock class="h-4 w-4" />
					ช่วงเวลารับของ
				</Tabs.Trigger>
			</Tabs.List>
		</div>

		<Tabs.Content value="list">
			{#if station}
				<ScanStation
					initialQuery={station.query}
					initialView={station.view}
					onSaved={refreshQueue}
					onClose={() => (station = null)}
				/>
			{:else if selectedPendingRequest}
				<PendingReviewDetail
					request={selectedPendingRequest}
					saving={pendingActionSaving}
					readonly={selectedPendingRequest.status === 'received'}
					onBack={() => (selectedPendingRequest = null)}
					onApprove={handleApprovePending}
					onReject={handleRejectPending}
					onRedirect={handleRedirectPending}
				/>
			{:else}
				<PendingReviewBoard
					requests={queueRows}
					loading={queue.isPending}
					error={queue.error?.message ?? null}
					onRetry={() => queue.refetch()}
					bind:filter={() => queueFilter, setQueueFilter}
					onViewDetails={openRow}
				>
					{#snippet received()}
						<ReceivedDonationsList
							rows={receivedRows}
							loading={receivedQuery.isPending}
							error={receivedQuery.error?.message ?? null}
							hasMore={receivedQuery.hasNextPage}
							loadingMore={receivedQuery.isFetchingNextPage}
							onLoadMore={() => receivedQuery.fetchNextPage()}
							onRetry={() => receivedQuery.refetch()}
							onViewDetails={openRow}
						/>
					{/snippet}
					{#snippet actions()}
						<Button
							type="button"
							onclick={() => (station = { view: 'scan', query: '' })}
							class="min-h-11 gap-2 rounded-xl bg-[#002D5B] text-sm font-bold text-white hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
						>
							<Scan class="h-4 w-4" />
							สแกนรับเข้าคลัง
						</Button>
						<Button
							variant="outline"
							type="button"
							onclick={() => (station = { view: 'walkin', query: '' })}
							class="min-h-11 gap-2 rounded-xl text-sm font-bold"
						>
							<User class="h-4 w-4" />
							ลงทะเบียน Walk-in
						</Button>
					{/snippet}
				</PendingReviewBoard>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="slots">
			<DonationSlotsManager />
		</Tabs.Content>

		<Tabs.Content value="needs">
			{#if viewState === 'list'}
				<NeedsBoardAdmin
					items={needsBoard.derivedItems}
					onAddRequest={() => (viewState = 'create')}
					onToggleShowOnHome={needsBoard.toggleShowOnHome}
					onToggleCutOff={handleToggleCutOff}
					onEdit={(item, itemId) => {
						selectedEditingItem = item;
						selectedEditingItemId = itemId;
						viewState = 'edit';
					}}
				/>
			{:else if viewState === 'create'}
				<CreateCampaignForm
					onclose={() => (viewState = 'list')}
					onsubmit={needsBoard.handleAddRequestFromForm}
				/>
			{:else if viewState === 'edit' && selectedEditingItem && selectedEditingItemId}
				<!-- Keyed on the row: the form seeds its fields once, so a different row
				     has to mount a fresh form rather than reuse the previous seed. -->
				{#key `${selectedEditingItem.id}:${selectedEditingItemId}`}
					<EditCampaignForm
						item={selectedEditingItem}
						itemId={selectedEditingItemId}
						onclose={() => {
							selectedEditingItem = null;
							selectedEditingItemId = '';
							viewState = 'list';
						}}
						onsubmit={(updatedData) => {
							if (!selectedEditingItem || !selectedEditingItemId) return;
							needsBoard.handleEditRequest(
								selectedEditingItem.id,
								selectedEditingItemId,
								updatedData
							);
							selectedEditingItem = null;
							selectedEditingItemId = '';
							viewState = 'list';
						}}
					/>
				{/key}
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</div>

<ForceCutoffDialog
	open={cutOffTarget !== null}
	itemName={cutOffTarget?.name ?? ''}
	oncancel={() => (cutOffTarget = null)}
	onconfirm={(reason) => {
		if (cutOffTarget) needsBoard.toggleCutOff(cutOffTarget.id, cutOffTarget.itemId, reason);
		cutOffTarget = null;
	}}
/>
