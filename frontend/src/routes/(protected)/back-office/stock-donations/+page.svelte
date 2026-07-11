<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import { toast } from 'svelte-sonner';
	import NeedsBoardAdmin from '$lib/components/needs-board-admin.svelte';
	import SpecialRequestDialog from '$lib/components/special-request-dialog.svelte';
	import PendingReviewBoard from '$lib/components/pending-review-board.svelte';
	import PendingReviewDialog from '$lib/components/pending-review-dialog.svelte';
	import ScanStation from './components/scan-station.svelte';
	import CreateCampaignForm from './components/create-campaign-form.svelte';
	import { startOperationsLiveQuery, useDonationNeedsBoard } from '$lib/features/operations';
	import { useQueryClient } from '@tanstack/svelte-query';

	const queryClient = useQueryClient();

	$effect(() => {
		const handle = startOperationsLiveQuery(queryClient);
		return () => handle.stop();
	});

	let activeSubTab = $state('scan'); // 'scan', 'pending', 'needs'
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

	let pendingRequests = $state([
		{
			id: '1',
			donorName: 'มูลนิธิใจบุญอารี',
			donorSubtitle: '(ล็อตใหญ่พิเศษ)',
			refId: 'RQ-9901',
			submittedTime: '10 นาทีที่แล้ว',
			triggerReason: 'โควต้าล็อตใหญ่เกินขีดจำกัดหน่วยคลังย่อยปกติ (Over-Limit Volume)',
			itemsList: 'เสื้อผ้าเครื่องนุ่งห่มมือสอง 5 รถบรรทุก, ข้าวสารหอมมะลิ 10 ตัน',
			statement:
				'เครื่องนุ่งห่มคัดแยกสภาพพร้อมใช้งานบรรจุกล่องกระดาษขนาดกลาง 250 กล่อง และข้าวสารขาวหอมมะลิอบพ่นฆ่ามอดบรรจุถุงพลาสติกหนาถุงละ 5 กิโลกรัม จำนวน 2,000 ถุง มีน้ำหนักรวมประมาณ 10,000 กิโลกรัม (10 ตัน) จำเป็นต้องเตรียมพนักงานยกขนย้ายและหาพาหนะรองรับวางเฉพาะเพื่อกันความชื้นและสะสม',
			vehicle: 'รถบรรทุกสิบล้อทะเบียนส่งออกพิเศษ (ต้องการจุดเลี่ยงรถติด)',
			location: 'อาคารคลังสินค้าอเนกประสงค์ (โซนปีกกลางแจ้ง)',
			schedule: '13 มิถุนายน 2026 (ช่วงเวลา 10:00 น. เป็นต้นไป)',
			contact: 'คุณพิมพ์มาดา (ผู้ประสานงาน) โทร. 081-456-7890 contact@jaiboon-foundation.or.th'
		},
		{
			id: '2',
			donorName: 'ห้างหุ้นส่วนจำกัด ร้านขายยาพิทักษ์ภัย',
			donorSubtitle: '',
			refId: 'RQ-9902',
			submittedTime: '30 นาทีที่แล้ว',
			triggerReason: 'เคมีภัณฑ์ประเภทพิเศษต้องการความเย็นควบคุมเฉพาะเจาะจง (Cold-Chain Req.)',
			itemsList: 'ยาปฏิชีวนะและวัคซีนพื้นฐาน 10,000 โดส, เจลลดไข้ 5,000 แผ่น',
			statement:
				'เวชภัณฑ์และเคมีภัณฑ์ควบคุมอุณหภูมิ บรรจุในกล่องโฟมรักษาความเย็นพิเศษพร้อม Ice Pack อุณหภูมิเป้าหมาย 2-8 องศาเซลเซียส จำเป็นต้องคัดกรองจัดสรรและขนย้ายเข้าตู้แช่เย็นของสถานพยาบาลหรือคลังควบคุมอุณหภูมิโดยทันทีเพื่อไม่ให้เสื่อมสภาพ',
			vehicle: 'รถกระบะห้องเย็นควบคุมอุณหภูมิ (มีเครื่องทำความเย็นทำงานตลอดเวลา)',
			location: 'คลังควบคุมอุณหภูมิ EOC (โซนยาและเวชภัณฑ์)',
			schedule: '14 มิถุนายน 2026 (ช่วงเวลา 09:00 - 12:00 น.)',
			contact: 'ภญ.วิภาวรรณ (เภสัชกรประจำคลัง) โทร. 089-765-4321 wipawan@pitakpai.co.th'
		}
	]);

	let selectedPendingRequest = $state<(typeof pendingRequests)[0] | null>(null);
	let isPendingModalOpen = $state(false);

	function handleApprovePending(id: string, memo: string) {
		const req = pendingRequests.find((r) => r.id === id);
		if (req) {
			toast.success(`อนุมัติคำขอ ${req.refId} เรียบร้อยแล้ว`);
			if (memo) toast.info(`บันทึกข้อความ: ${memo}`);
			pendingRequests = pendingRequests.filter((r) => r.id !== id);
		}
		isPendingModalOpen = false;
	}

	function handleForwardPending(id: string, memo: string) {
		const req = pendingRequests.find((r) => r.id === id);
		if (req) {
			toast.success(`ส่งต่อคำขอ ${req.refId} ไปยังส่วนประสานงานแล้ว`);
			if (memo) toast.info(`บันทึกข้อความ: ${memo}`);
			pendingRequests = pendingRequests.filter((r) => r.id !== id);
		}
		isPendingModalOpen = false;
	}

	function handleRejectPending(id: string, memo: string) {
		const req = pendingRequests.find((r) => r.id === id);
		if (req) {
			toast.error(`ปฏิเสธคำขอ ${req.refId} เรียบร้อยแล้ว`);
			if (memo) toast.info(`เหตุผลการปฏิเสธ: ${memo}`);
			pendingRequests = pendingRequests.filter((r) => r.id !== id);
		}
		isPendingModalOpen = false;
	}
</script>

<div class="flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
	<div
		class="flex scrollbar-none items-center justify-start overflow-x-auto border-b border-border"
	>
		<div class="-mb-px flex gap-2 whitespace-nowrap">
			<button
				onclick={() => {
					activeSubTab = 'scan';
					viewState = 'list';
				}}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'scan'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Scan class="h-3.5 w-3.5" />
				สแกนรับของเข้าคลัง
			</button>

			<button
				onclick={() => {
					activeSubTab = 'pending';
					viewState = 'list';
				}}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'pending'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<ClipboardList class="h-3.5 w-3.5" />
				รายการรอตรวจสอบ
				{#if pendingRequests.length > 0}
					<span
						class="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] leading-none font-bold text-white"
						>{pendingRequests.length}</span
					>
				{/if}
			</button>

			<button
				onclick={() => {
					activeSubTab = 'needs';
					viewState = 'list';
				}}
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
		<PendingReviewBoard
			requests={pendingRequests}
			onViewDetails={(req) => {
				selectedPendingRequest = req;
				isPendingModalOpen = true;
			}}
		/>
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

<PendingReviewDialog
	open={isPendingModalOpen}
	request={selectedPendingRequest}
	onclose={() => (isPendingModalOpen = false)}
	onApprove={handleApprovePending}
	onForward={handleForwardPending}
	onReject={handleRejectPending}
/>
