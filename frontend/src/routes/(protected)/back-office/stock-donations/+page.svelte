<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import NeedsBoardAdmin from '$lib/components/needs-board-admin.svelte';
	import SpecialRequestDialog from '$lib/components/special-request-dialog.svelte';
	import PendingReviewBoard from '$lib/components/pending-review-board.svelte';
	import PendingReviewDetail from '$lib/components/pending-review-detail.svelte';
	import ScanStation from './components/scan-station.svelte';
	import CreateCampaignForm from './components/create-campaign-form.svelte';
	import EditCampaignForm from './components/edit-campaign-form.svelte';
	import ForceCutoffDialog from './components/force-cutoff-dialog.svelte';
	import { useDonationNeedsBoard, type NeedItem } from '$lib/features/operations';
	import type { PendingDonationRow } from '$lib/features/donations';

	/**
	 * Tabs actually offered: `scan | pending | needs`.
	 *
	 * Two more used to sit here and were taken off on 2026-09-01 (D-11 / D-9):
	 *
	 * · **กำลังตรวจรับ** — the drop-off queue moved INTO the scan station, which now
	 *   lists everything awaiting arrival (`verifying`, `pending_review`, `declared`)
	 *   and is where the counting happens anyway. The tab showed the same rows twice.
	 *   The `verifying` STATUS stays: the approve button creates it, and it is what
	 *   makes the donor's QR appear (CR-052 §1.4).
	 * · **ส่งต่อเข้ามา** — read-only with nowhere to go: a `donation_redirect` ticket
	 *   cannot yet be turned into stock at the destination (D-9 undecided), and the
	 *   design does not carry the tab.
	 *
	 * Both boards still exist (`verifying-board.svelte`,
	 * `incoming-redirects-board.svelte`) and their routes still serve data — putting a
	 * tab back is re-adding a button and a branch, not rebuilding a feature.
	 */
	let activeSubTab = $state('scan');
	let viewState = $state<'list' | 'create' | 'edit'>('list');
	// One board row = one need, so the edit target is (campaign, item), never just the campaign.
	let selectedEditingItem = $state<NeedItem | null>(null);
	let selectedEditingItemId = $state('');
	let isModalOpen = $state(false);

	const needsBoard = useDonationNeedsBoard({
		onRequestCreated: () => {
			isModalOpen = false;
		},
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

	// R-16.1 — pending-review queue, loaded from the real intake API (no mock array).
	let pendingRequests = $state<PendingDonationRow[]>([]);
	let pendingLoading = $state(false);
	let selectedPendingRequest = $state<PendingDonationRow | null>(null);
	let pendingActionSaving = $state(false);

	async function loadPending() {
		pendingLoading = true;
		try {
			const res = await fetch('/api/back-office/donations?status=pending_review');
			const data = await res.json();
			pendingRequests = data.success ? (data.donations as PendingDonationRow[]) : [];
		} catch {
			toast.error('โหลดรายการรอการประเมินไม่สำเร็จ');
		} finally {
			pendingLoading = false;
		}
	}

	function switchTab(tab: string) {
		activeSubTab = tab;
		viewState = 'list';
		selectedPendingRequest = null;
		if (tab === 'pending') loadPending();
	}

	async function handleApprovePending(bookingRef: string, memo: string) {
		if (!bookingRef || pendingActionSaving) return;
		pendingActionSaving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(bookingRef)}/approve`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ memo })
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(`อนุมัติคำขอ ${bookingRef} เข้าสู่การตรวจรับแล้ว`);
				selectedPendingRequest = null;
				await loadPending();
			} else {
				toast.error(data.error || 'อนุมัติไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			pendingActionSaving = false;
		}
	}

	async function handleRejectPending(bookingRef: string, reason: string) {
		if (!bookingRef || pendingActionSaving) return;
		pendingActionSaving = true;
		try {
			const res = await fetch(
				`/api/back-office/donations/${encodeURIComponent(bookingRef)}/reject`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ reason })
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(`ปฏิเสธคำขอ ${bookingRef} เรียบร้อยแล้ว`);
				selectedPendingRequest = null;
				await loadPending();
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
						...(note ? { note } : {})
					})
				}
			);
			const data = await res.json();
			if (data.success) {
				toast.success(
					`ส่งต่อคำขอ ${bookingRef} ไปยังศูนย์ ${targetShelterCode} เรียบร้อยแล้ว — ศูนย์ปลายทางจะเห็นคำขอนี้ในคิวของตัวเอง`
				);
				selectedPendingRequest = null;
				await loadPending();
			} else {
				toast.error(data.error || 'ส่งต่อไม่สำเร็จ');
			}
		} catch {
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			pendingActionSaving = false;
		}
	}

	// The queue loads at mount, not on first click: the tab badge is the only signal
	// that something is waiting, and a badge that appears only after you open the tab
	// tells you nothing.
	loadPending();
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
		<Tabs.List class="h-auto max-w-full scrollbar-none justify-start overflow-x-auto">
			<Tabs.Trigger value="scan" class="gap-2 px-3 py-2 text-xs font-bold">
				<Scan class="h-3.5 w-3.5" />
				สแกนรับของเข้าคลัง
			</Tabs.Trigger>

			<Tabs.Trigger value="pending" class="gap-2 px-3 py-2 text-xs font-bold">
				<ClipboardList class="h-3.5 w-3.5" />
				รอการประเมิน
				{#if pendingRequests.length > 0}
					<Badge class="h-4 min-w-4 bg-amber-500 px-1.5 text-2xs leading-none font-bold text-white">
						{pendingRequests.length}
					</Badge>
				{/if}
			</Tabs.Trigger>

			<Tabs.Trigger value="needs" class="gap-2 px-3 py-2 text-xs font-bold">
				<Megaphone class="h-3.5 w-3.5" />
				จัดการความต้องการ
			</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="scan">
			<ScanStation />
		</Tabs.Content>

		<Tabs.Content value="pending">
			{#if selectedPendingRequest}
				<PendingReviewDetail
					request={selectedPendingRequest}
					saving={pendingActionSaving}
					onBack={() => (selectedPendingRequest = null)}
					onApprove={handleApprovePending}
					onReject={handleRejectPending}
					onRedirect={handleRedirectPending}
				/>
			{:else}
				<PendingReviewBoard
					requests={pendingRequests}
					loading={pendingLoading}
					onViewDetails={(req) => {
						selectedPendingRequest = req;
					}}
				/>
			{/if}
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

<SpecialRequestDialog
	open={isModalOpen}
	onclose={() => (isModalOpen = false)}
	onsubmit={needsBoard.handleAddRequest}
/>

<ForceCutoffDialog
	open={cutOffTarget !== null}
	itemName={cutOffTarget?.name ?? ''}
	oncancel={() => (cutOffTarget = null)}
	onconfirm={(reason) => {
		if (cutOffTarget) needsBoard.toggleCutOff(cutOffTarget.id, cutOffTarget.itemId, reason);
		cutOffTarget = null;
	}}
/>
