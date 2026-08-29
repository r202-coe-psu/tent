<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Inbox from '@lucide/svelte/icons/inbox';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { toast } from 'svelte-sonner';
	import NeedsBoardAdmin from '$lib/components/needs-board-admin.svelte';
	import SpecialRequestDialog from '$lib/components/special-request-dialog.svelte';
	import PendingReviewBoard from '$lib/components/pending-review-board.svelte';
	import PendingReviewDetail from '$lib/components/pending-review-detail.svelte';
	import VerifyingBoard from '$lib/components/verifying-board.svelte';
	import IncomingRedirectsBoard from '$lib/components/incoming-redirects-board.svelte';
	import ScanStation from './components/scan-station.svelte';
	import CreateCampaignForm from './components/create-campaign-form.svelte';
	import { useDonationNeedsBoard } from '$lib/features/operations';
	import type { DonationRedirect, PendingDonationRow } from '$lib/features/donations';

	let activeSubTab = $state('scan'); // 'scan', 'pending', 'verifying', 'incoming', 'needs'
	let viewState = $state<'list' | 'create'>('list');
	let isModalOpen = $state(false);

	const needsBoard = useDonationNeedsBoard({
		onRequestCreated: () => {
			isModalOpen = false;
		},
		onFormCreated: () => {
			viewState = 'list';
		}
	});

	// R-16.1 — pending-review queue, loaded from the real intake API (no mock array).
	let pendingRequests = $state<PendingDonationRow[]>([]);
	let pendingLoading = $state(false);
	let selectedPendingRequest = $state<PendingDonationRow | null>(null);
	let pendingActionSaving = $state(false);

	// R-16.4 — redirect tickets other shelters handed to this one (CR-087).
	let incomingRedirects = $state<DonationRedirect[]>([]);
	let incomingLoading = $state(false);

	// R-16.5 — verifying (drop-off) queue.
	let verifyingRequests = $state<PendingDonationRow[]>([]);
	let verifyingLoading = $state(false);
	let verifyingBookingRef = $state<string | null>(null);

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

	async function loadVerifying() {
		verifyingLoading = true;
		try {
			const res = await fetch('/api/back-office/donations?status=verifying');
			const data = await res.json();
			verifyingRequests = data.success ? (data.donations as PendingDonationRow[]) : [];
		} catch {
			toast.error('โหลดรายการกำลังตรวจรับไม่สำเร็จ');
		} finally {
			verifyingLoading = false;
		}
	}

	async function loadIncomingRedirects() {
		incomingLoading = true;
		try {
			const res = await fetch('/api/back-office/donations/redirects');
			const data = await res.json();
			incomingRedirects = data.success ? (data.redirects as DonationRedirect[]) : [];
		} catch {
			toast.error('โหลดคำขอที่ถูกส่งต่อมาไม่สำเร็จ');
		} finally {
			incomingLoading = false;
		}
	}

	function switchTab(tab: string) {
		activeSubTab = tab;
		viewState = 'list';
		selectedPendingRequest = null;
		verifyingBookingRef = null;
		if (tab === 'pending') loadPending();
		if (tab === 'verifying') loadVerifying();
		if (tab === 'incoming') loadIncomingRedirects();
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

	// Every queue loads at mount, not on first click: the tab badges are the only
	// signal that something is waiting, and a badge that appears only after you
	// open the tab tells you nothing.
	loadPending();
	loadVerifying();
	loadIncomingRedirects();
</script>

<div class="flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
	<div
		class="flex scrollbar-none items-center justify-start overflow-x-auto border-b border-border"
	>
		<div class="-mb-px flex gap-2 whitespace-nowrap">
			<button
				onclick={() => switchTab('scan')}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'scan'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Scan class="h-3.5 w-3.5" />
				สแกนรับของเข้าคลัง
			</button>

			<button
				onclick={() => switchTab('pending')}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'pending'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<ClipboardList class="h-3.5 w-3.5" />
				รอการประเมิน
				{#if pendingRequests.length > 0}
					<span
						class="rounded-full bg-amber-500 px-1.5 py-0.5 text-2xs leading-none font-bold text-white"
						>{pendingRequests.length}</span
					>
				{/if}
			</button>

			<button
				onclick={() => switchTab('verifying')}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'verifying'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<PackageCheck class="h-3.5 w-3.5" />
				กำลังตรวจรับ
				{#if verifyingRequests.length > 0}
					<span
						class="rounded-full bg-amber-500 px-1.5 py-0.5 text-2xs leading-none font-bold text-white"
						>{verifyingRequests.length}</span
					>
				{/if}
			</button>

			<button
				onclick={() => switchTab('incoming')}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'incoming'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Inbox class="h-3.5 w-3.5" />
				ส่งต่อเข้ามา
				{#if incomingRedirects.length > 0}
					<span
						class="rounded-full bg-blue-500 px-1.5 py-0.5 text-2xs leading-none font-bold text-white"
						>{incomingRedirects.length}</span
					>
				{/if}
			</button>

			<button
				onclick={() => switchTab('needs')}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'needs'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Megaphone class="h-3.5 w-3.5" />
				จัดการความต้องการ
			</button>
		</div>
	</div>

	{#if activeSubTab === 'scan'}
		<ScanStation />
	{:else if activeSubTab === 'pending'}
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
	{:else if activeSubTab === 'verifying'}
		{#if verifyingBookingRef}
			<div class="flex flex-col gap-3">
				<button
					onclick={() => (verifyingBookingRef = null)}
					class="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted"
				>
					<ArrowLeft class="h-3.5 w-3.5" />
					กลับไปรายการกำลังตรวจรับ
				</button>
				<ScanStation
					initialQuery={verifyingBookingRef}
					onSaved={() => {
						verifyingBookingRef = null;
						loadVerifying();
					}}
					onClose={() => (verifyingBookingRef = null)}
				/>
			</div>
		{:else}
			<VerifyingBoard
				requests={verifyingRequests}
				loading={verifyingLoading}
				onVerify={(bookingRef) => (verifyingBookingRef = bookingRef)}
			/>
		{/if}
	{:else if activeSubTab === 'incoming'}
		<IncomingRedirectsBoard redirects={incomingRedirects} loading={incomingLoading} />
	{:else if activeSubTab === 'needs'}
		{#if viewState === 'list'}
			<NeedsBoardAdmin
				items={needsBoard.derivedItems}
				onAddRequest={() => (viewState = 'create')}
				onToggleShowOnHome={needsBoard.toggleShowOnHome}
				onToggleCutOff={needsBoard.toggleCutOff}
			/>
		{:else}
			<CreateCampaignForm
				onclose={() => (viewState = 'list')}
				onsubmit={needsBoard.handleAddRequestFromForm}
			/>
		{/if}
	{/if}
</div>

<SpecialRequestDialog
	open={isModalOpen}
	onclose={() => (isModalOpen = false)}
	onsubmit={needsBoard.handleAddRequest}
/>
