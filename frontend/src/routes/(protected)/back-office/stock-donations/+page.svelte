<script lang="ts">
	import Scan from '@lucide/svelte/icons/scan';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import { toast } from 'svelte-sonner';
	import NeedsBoardAdmin from './components/needs-board-admin.svelte';
	import SpecialRequestDialog from './components/special-request-dialog.svelte';
	import PendingReviewBoard from './components/pending-review-board.svelte';
	import PendingReviewDialog from './components/pending-review-dialog.svelte';
	import ScanStation from './components/scan-station.svelte';
	import {
		useCampaigns,
		useStockLedgers,
		useDonations,
		useCreateCampaign,
		useUpdateCampaign,
		stockBalance,
		SHELTER_CODE,
		type SpecialRequestInput,
		type Donation,
		calculateReserved,
		isNeedCutOff
	} from '$lib/features/operations';
	import { authStore } from '$lib/stores/auth.svelte';
	import type { NeedItem } from './components/needs-board-admin.svelte';

	let activeSubTab = $state('scan'); // 'scan', 'pending', 'needs'
	let isModalOpen = $state(false);

	const campaignsQuery = useCampaigns();
	const stockLedgersQuery = useStockLedgers();
	const donationsQuery = useDonations();

	const createCampaignMutation = useCreateCampaign();
	const updateCampaignMutation = useUpdateCampaign();

	const ITEM_NAMES: Record<string, string> = {
		'item:rice': 'ข้าวสาร (ข้าวหอมมะลิ 100%)',
		'item:water': 'น้ำดื่มบรรจุขวด 1.5L',
		'item:paracetamol': 'ยาพาราเซตามอล',
		'item:soap': 'สบู่ก้อน',
		'item:blanket': 'ผ้าห่มกันหนาว',
		'item:egg': 'ไข่ไก่สด'
	};

	const balances = $derived(stockBalance(stockLedgersQuery.data ?? []));

	const ctx = $derived({
		shelterCode: SHELTER_CODE,
		createdBy: authStore.user?.name ?? 'system'
	});

	const derivedItems = $derived.by(() => {
		const campaigns = campaignsQuery.data ?? [];
		const donations = donationsQuery.data ?? [];
		const stockLedgers = stockLedgersQuery.data ?? [];

		const reservedMap = calculateReserved(donations, stockLedgers);

		const list: NeedItem[] = [];
		for (const camp of campaigns) {
			const needs: NeedItem['needs'] = [];
			let allNeedsCutOff = true;

			for (const need of camp.needs) {
				const itemId = need.item_id;
				const reserved = reservedMap.get(itemId) ?? 0;
				const onHand = balances.get(itemId) ?? 0;
				const target = need.qty_target;

				const isCutOff = isNeedCutOff(target, onHand, reserved, need.status, camp.status);
				const isNeedManualClosed = need.status === 'closed';

				if (!isCutOff) {
					allNeedsCutOff = false;
				}

				needs.push({
					itemId: itemId,
					name: ITEM_NAMES[itemId] ?? (itemId.startsWith('item:') ? itemId.slice(5) : itemId),
					reserved: reserved,
					onHand: onHand,
					target: target,
					unit: need.unit,
					isCutOff: isCutOff,
					isManualClosed: isNeedManualClosed
				});
			}

			const isManualClosed = camp.status === 'closed';
			const isCutOff = allNeedsCutOff || isManualClosed;

			list.push({
				id: camp._id,
				title: camp.title || 'ประกาศช่วยเหลือภัยพิบัติ EOC',
				location: camp.notes || 'คลังช่วยเหลือภัยพิบัติ EOC',
				needs: needs,
				showOnHome: camp.visible_on_home !== false,
				isCutOff: isCutOff,
				isManualClosed: isManualClosed,
				campaignDoc: camp
			});
		}
		return list;
	});

	function toggleShowOnHome(compoundId: string) {
		const targetItem = derivedItems.find((i) => i.id === compoundId);
		if (targetItem) {
			const campaign = targetItem.campaignDoc;
			const nextVisible = campaign.visible_on_home === false ? true : false;
			updateCampaignMutation.mutate(
				{
					campaign: {
						...campaign,
						visible_on_home: nextVisible
					},
					auditInput: {
						action: 'manual_adjust',
						reason: nextVisible
							? `เจ้าหน้าที่เปิดแสดงแคมเปญบนหน้าแรก: ${targetItem.title}`
							: `เจ้าหน้าที่ซ่อนแคมเปญจากหน้าแรก: ${targetItem.title}`,
						ctx: ctx
					}
				},
				{
					onSuccess: () => {
						toast.success(
							nextVisible
								? `กำลังโปรโมต "${targetItem.title}" บนหน้าแรก`
								: `ซ่อน "${targetItem.title}" จากหน้าแรก`
						);
					},
					onError: (err) => {
						toast.error(`ไม่สามารถแก้ไขการโปรโมตได้: ${err.message}`);
					}
				}
			);
		}
	}

	function toggleCutOff(compoundId: string, itemId: string) {
		const targetItem = derivedItems.find((i) => i.id === compoundId);
		if (targetItem) {
			const campaign = targetItem.campaignDoc;

			const targetNeed = campaign.needs.find((n) => n.item_id === itemId);
			const toggledStatus: 'open' | 'closed' = targetNeed?.status === 'closed' ? 'open' : 'closed';
			const updatedNeeds = campaign.needs.map((need) => {
				if (need.item_id === itemId) {
					return {
						...need,
						status: toggledStatus
					};
				}
				return need;
			});

			const itemName =
				ITEM_NAMES[itemId] ?? (itemId.startsWith('item:') ? itemId.slice(5) : itemId);

			updateCampaignMutation.mutate(
				{
					campaign: {
						...campaign,
						needs: updatedNeeds
					},
					auditInput: {
						action: 'manual_adjust',
						reason:
							toggledStatus === 'closed'
								? `เจ้าหน้าที่บังคับปิดรับบริจาคสำหรับพัสดุ: ${itemName} ในแคมเปญ ${targetItem.title}`
								: `เจ้าหน้าที่เปิดรับบริจาคพัสดุอีกครั้ง: ${itemName} ในแคมเปญ ${targetItem.title}`,
						ctx: ctx
					}
				},
				{
					onSuccess: () => {
						toast.success(
							toggledStatus === 'closed'
								? `ปิดรับบริจาคสำหรับ "${itemName}" แล้ว`
								: `เปิดรับบริจาคสำหรับ "${itemName}" อีกครั้ง`
						);
					},
					onError: (err) => {
						toast.error(`ไม่สามารถบันทึกสถานะได้: ${err.message}`);
					}
				}
			);
		}
	}

	function handleAddRequest(input: SpecialRequestInput) {
		const lowerName = input.name.toLowerCase();
		let itemId = 'item:custom';
		if (lowerName.includes('ข้าว')) itemId = 'item:rice';
		else if (lowerName.includes('น้ำ')) itemId = 'item:water';
		else if (lowerName.includes('พารา') || lowerName.includes('ยา')) itemId = 'item:paracetamol';
		else if (lowerName.includes('สบู่')) itemId = 'item:soap';
		else if (lowerName.includes('ห่ม')) itemId = 'item:blanket';
		else if (lowerName.includes('ไข่')) itemId = 'item:egg';
		else {
			const slug = input.name
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9\u0e00-\u0e7f]+/g, '-')
				.replace(/^-+|-+$/g, '');
			itemId = `item:${slug || 'custom'}`;
		}

		const newCampaignInput = {
			title: input.name,
			needs: [
				{
					item_id: itemId,
					qty_target: input.target,
					unit: 'ชิ้น'
				}
			],
			notes: `ประกาศพิเศษสำหรับคลัง: ${input.location}`
		};

		createCampaignMutation.mutate(
			{
				input: newCampaignInput,
				ctx: ctx
			},
			{
				onSuccess: () => {
					toast.success(`เพิ่มประกาศความต้องการ "${input.name}" สำเร็จ`);
					isModalOpen = false;
				},
				onError: (err) => {
					toast.error(`ไม่สามารถสร้างประกาศได้: ${err.message}`);
				}
			}
		);
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

<div class="flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
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
			items={derivedItems}
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
