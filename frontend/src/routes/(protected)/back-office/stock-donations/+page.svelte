<script lang="ts">
	import Package from '@lucide/svelte/icons/package';
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import { toast } from 'svelte-sonner';
	import NeedsBoardAdmin from './components/needs-board-admin.svelte';
	import SpecialRequestDialog from './components/special-request-dialog.svelte';
	import PendingReviewBoard from './components/pending-review-board.svelte';
	import PendingReviewDialog from './components/pending-review-dialog.svelte';
	import ScanStation from './components/scan-station.svelte';
	import type { SpecialRequestInput } from '$lib/features/operations';

	let selectedShelter = $state('shelter-1');
	let activeSubTab = $state('scan'); // 'scan', 'pending', 'needs'
	let isModalOpen = $state(false);

	let items = $state([
		{
			id: '1',
			name: 'ข้าวสาร (ข้าวหอมมะลิ 100%)',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 450,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '2',
			name: 'เนื้อไก่สด (เนื้อส่วนอก / สะโพก)',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 150,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '3',
			name: 'น้ำดื่มบรรจุขวด 1.5L',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 600,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '4',
			name: 'ข้าวสาร (ข้าวหอมมะลิ 100%)',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 80,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		},
		{
			id: '5',
			name: 'น้ำดื่มบรรจุขวด 1.5L',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			reserved: 120,
			target: 1000,
			showOnHome: true,
			isCutOff: false
		}
	]);

	function toggleShowOnHome(itemId: string) {
		const item = items.find((i) => i.id === itemId);
		if (item) {
			item.showOnHome = !item.showOnHome;
			toast.success(
				item.showOnHome ? `กำลังโปรโมต "${item.name}" บนหน้าแรก` : `ซ่อน "${item.name}" จากหน้าแรก`
			);
		}
	}

	function toggleCutOff(itemId: string) {
		const item = items.find((i) => i.id === itemId);
		if (item) {
			item.isCutOff = !item.isCutOff;
			toast.success(
				item.isCutOff
					? `ปิดรับบริจาคสำหรับ "${item.name}" แล้ว`
					: `เปิดรับบริจาคสำหรับ "${item.name}" อีกครั้ง`
			);
		}
	}

	function handleAddRequest(input: SpecialRequestInput) {
		items.push({
			id: String(items.length + 1),
			name: input.name,
			location: input.location,
			reserved: 0,
			target: input.target,
			showOnHome: true,
			isCutOff: false
		});
		toast.success(`เพิ่มประกาศความต้องการ "${input.name}" สำเร็จ`);
	}

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

<header
	class="flex shrink-0 flex-col gap-4 border-b border-sidebar-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6"
>
	<div class="flex items-center gap-2">
		<Package class="h-5 w-5 text-muted-foreground" />
		<h1 class="text-base font-bold text-foreground">คลังทรัพยากร (Stock & Donations)</h1>
	</div>

	<div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between md:w-auto">
		<div class="flex w-full items-center gap-1.5 text-xs text-muted-foreground sm:w-auto">
			<span class="shrink-0">ศูนย์อพยพ:</span>
			<select
				bind:value={selectedShelter}
				class="w-full max-w-full truncate rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary sm:w-auto sm:max-w-[280px] md:max-w-xs"
			>
				<option value="shelter-1">ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)</option>
				<option value="shelter-2">ศูนย์พักพิง เทศบาลเมืองคลองแห (โรงเรียนวัดคลองแห)</option>
			</select>
		</div>

		<span
			class="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-600 sm:self-auto"
		>
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"></span>
			Offline Mode
		</span>
	</div>
</header>

<div class="flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
	<div
		class="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-800 md:p-4 dark:text-amber-300"
	>
		<AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
		<div>
			<h4 class="text-xs font-bold">Offline Mode: เปิดใช้งานระบบบันทึกในเครื่อง</h4>
			<p class="mt-1 text-[11px] leading-relaxed opacity-90">
				ระบบอ่าน-เขียนข้อมูลไปยังคอมพิวเตอร์ของคุณโดยตรง
				จะทำการซิงก์ข้อมูลขึ้นคลาวด์อัตโนมัติเมื่อตรวจพบการเชื่อมต่อออนไลน์
			</p>
		</div>
	</div>

	<div
		class="flex scrollbar-none items-center justify-start overflow-x-auto border-b border-border"
	>
		<div class="-mb-px flex gap-2 whitespace-nowrap">
			<button
				onclick={() => (activeSubTab = 'scan')}
				class="flex items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-bold transition-all md:px-4 md:py-3 {activeSubTab ===
				'scan'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Scan class="h-3.5 w-3.5" />
				สแกนรับของเข้าคลัง
			</button>

			<button
				onclick={() => (activeSubTab = 'pending')}
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
				onclick={() => (activeSubTab = 'needs')}
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
		<NeedsBoardAdmin
			{items}
			onAddRequest={() => (isModalOpen = true)}
			onToggleShowOnHome={toggleShowOnHome}
			onToggleCutOff={toggleCutOff}
		/>
	{/if}
</div>

<SpecialRequestDialog
	open={isModalOpen}
	onclose={() => (isModalOpen = false)}
	onsubmit={handleAddRequest}
/>

<PendingReviewDialog
	open={isPendingModalOpen}
	request={selectedPendingRequest}
	onclose={() => (isPendingModalOpen = false)}
	onApprove={handleApprovePending}
	onForward={handleForwardPending}
	onReject={handleRejectPending}
/>
