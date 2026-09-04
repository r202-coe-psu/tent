<script lang="ts">
	import {
		useKitchenRequisitions,
		useApproveRequisitionTicket,
		useRejectRequisitionTicket,
		useMealPlans,
		useGasCylinderTypes,
		useGasLedger,
		gasCylinderBalance,
		MEAL_PERIOD_LABELS,
		toMealPlanMap,
		type KitchenRequisition
	} from '$lib/features/kitchen';
	import { useStockBalance } from '$lib/features/operations';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { qtyGt, persistQty } from '$lib/utils/qty';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import Search from '@lucide/svelte/icons/search';
	import Eye from '@lucide/svelte/icons/eye';
	import Flame from '@lucide/svelte/icons/flame';
	import Check from '@lucide/svelte/icons/check';
	import { useItemMasters, getItemDisplayName } from '$lib/features/catalog';
	import { useSupplyItems } from '$lib/features/supply';
	import { formatThaiDateTime } from '$lib/utils/date';

	const requisitions = useKitchenRequisitions();
	const plans = useMealPlans();
	const stock = useStockBalance();
	const gasTypes = useGasCylinderTypes();
	const gasLedger = useGasLedger();
	const itemMasters = useItemMasters(() => getShelterCode());
	const supplyItems = useSupplyItems();

	const getItemName = (id: string) => getItemDisplayName(id, itemMasters.data, supplyItems.data);

	const approveMutation = useApproveRequisitionTicket();
	const rejectMutation = useRejectRequisitionTicket();

	let filterStatus = $state<'all' | 'pending' | 'approved' | 'rejected'>('pending');
	let searchQuery = $state('');

	// Inspection Dialog State
	let inspectingTicket = $state<KitchenRequisition | null>(null);
	let inspectionDialogOpen = $state(false);

	// Partial issue inputs: itemId -> qty_issued string
	let partialIssueMap = $state<Record<string, string>>({});
	// Switched gas inputs: original cylinder_id -> new cylinder_id
	let switchedGasMap = $state<Record<string, string>>({});

	// Rejection Reason State
	let rejectDialogOpen = $state(false);
	let rejectReasonText = $state('');

	const planById = $derived(toMealPlanMap(plans.data));

	const filteredRequisitions = $derived.by(() => {
		const list = [...(requisitions.data ?? [])];
		// Sort newest first
		list.sort((a, b) => b.created_at.localeCompare(a.created_at));

		return list.filter((r) => {
			if (filterStatus !== 'all' && r.status !== filterStatus) return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				const ticketMatch = r.ticket_no.toLowerCase().includes(q);
				const plan = r.meal_plan_id ? planById[r.meal_plan_id] : null;
				const planMatch = plan?.label?.toLowerCase().includes(q);
				if (!ticketMatch && !planMatch) return false;
			}
			return true;
		});
	});

	const pendingCount = $derived(
		(requisitions.data ?? []).filter((r) => r.status === 'pending').length
	);

	function openInspection(ticket: KitchenRequisition) {
		inspectingTicket = ticket;
		// Initialize partialIssueMap with requested quantities
		const pMap: Record<string, string> = {};
		for (const item of ticket.items) {
			pMap[item.item_id] = item.qty_issued !== '0' ? item.qty_issued : item.qty_requested;
		}
		partialIssueMap = pMap;

		// Initialize switchedGasMap
		const gMap: Record<string, string> = {};
		for (const g of ticket.gas_drawdown ?? []) {
			gMap[g.cylinder_id] = g.cylinder_id;
		}
		switchedGasMap = gMap;

		inspectionDialogOpen = true;
	}

	async function handleApprove() {
		if (!inspectingTicket) return;

		// Prepare partial items
		const partial_items = inspectingTicket.items.map((item) => ({
			item_id: item.item_id,
			qty_issued: persistQty(partialIssueMap[item.item_id] ?? item.qty_requested)
		}));

		// Prepare switched gas
		const switched_gas = (inspectingTicket.gas_drawdown ?? []).map((g) => ({
			cylinder_id: switchedGasMap[g.cylinder_id] ?? g.cylinder_id,
			qty_kg: g.qty_kg
		}));

		try {
			await approveMutation.mutateAsync({
				requisitionId: inspectingTicket._id,
				approver: authStore.user?.name ?? 'warehouse_staff',
				options: {
					partial_items,
					switched_gas
				},
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'warehouse_staff'
				}
			});
			toast.success(`อนุมัติคำขอเบิก ${inspectingTicket.ticket_no} และตัดสต็อกสำเร็จแล้ว`);
			inspectionDialogOpen = false;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการอนุมัติคำขอเบิก';
			toast.error(msg);
		}
	}

	function openRejectDialog() {
		rejectReasonText = '';
		rejectDialogOpen = true;
	}

	async function handleReject() {
		if (!inspectingTicket) return;
		if (!rejectReasonText.trim()) {
			toast.error('กรุณาระบุเหตุผลการปฏิเสธคำขอ');
			return;
		}

		try {
			await rejectMutation.mutateAsync({
				requisitionId: inspectingTicket._id,
				reason: rejectReasonText.trim(),
				ctx: {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'warehouse_staff'
				}
			});
			toast.success(`ปฏิเสธคำขอเบิก ${inspectingTicket.ticket_no} แล้ว`);
			rejectDialogOpen = false;
			inspectionDialogOpen = false;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'ไม่สามารถปฏิเสธคำขอได้';
			toast.error(msg);
		}
	}
</script>

<div class="space-y-4 p-4">
	<!-- Top Bar -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="flex items-center gap-3">
			<div class="rounded-lg bg-amber-50 p-2 text-amber-600">
				<ClipboardList class="h-5 w-5" />
			</div>
			<div>
				<h3 class="text-base font-bold text-foreground">
					คำขอเบิกวัตถุดิบและแก๊สโรงครัว (Kitchen Requisitions)
				</h3>
				<p class="text-xs text-muted-foreground">
					ตรวจสอบคำขอเบิกจากโรงครัว อนุมัติจ่ายวัตถุดิบและตัดสต็อกสินค้าและแก๊สแบบ Real-time
				</p>
			</div>
		</div>

		{#if pendingCount > 0}
			<span
				class="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800"
			>
				<Clock class="h-3.5 w-3.5" /> รอตรวจสอบ {pendingCount} รายการ
			</span>
		{/if}
	</div>

	<!-- Filter & Search Controls -->
	<Card.Root class="border-0 shadow-sm">
		<Card.Content class="flex flex-wrap items-center justify-between gap-3 p-3">
			<div class="flex flex-wrap items-center gap-1.5">
				<Button
					variant={filterStatus === 'all' ? 'default' : 'outline'}
					size="sm"
					class="h-8 text-xs"
					onclick={() => (filterStatus = 'all')}
				>
					ทั้งหมด ({requisitions.data?.length ?? 0})
				</Button>
				<Button
					variant={filterStatus === 'pending' ? 'default' : 'outline'}
					size="sm"
					class="h-8 text-xs"
					onclick={() => (filterStatus = 'pending')}
				>
					รอดำเนินการ ({pendingCount})
				</Button>
				<Button
					variant={filterStatus === 'approved' ? 'default' : 'outline'}
					size="sm"
					class="h-8 text-xs"
					onclick={() => (filterStatus = 'approved')}
				>
					อนุมัติแล้ว ({(requisitions.data ?? []).filter((r) => r.status === 'approved').length})
				</Button>
				<Button
					variant={filterStatus === 'rejected' ? 'default' : 'outline'}
					size="sm"
					class="h-8 text-xs"
					onclick={() => (filterStatus = 'rejected')}
				>
					ปฏิเสธแล้ว ({(requisitions.data ?? []).filter((r) => r.status === 'rejected').length})
				</Button>
			</div>

			<div class="relative min-w-[220px]">
				<Search class="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
				<Input
					bind:value={searchQuery}
					placeholder="ค้นหาเลขตั๋ว, เมนู..."
					class="h-8 pl-8 text-xs"
				/>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Table of Requisitions -->
	<Card.Root class="overflow-hidden border shadow-sm">
		{#if requisitions.isLoading}
			<div class="flex items-center justify-center p-12 text-muted-foreground">
				<Clock class="mr-2 h-5 w-5 animate-spin" /> กำลังโหลดคำขอเบิก...
			</div>
		{:else if filteredRequisitions.length === 0}
			<div class="p-12 text-center text-muted-foreground">
				<ClipboardList class="mx-auto h-8 w-8 text-muted-foreground/40" />
				<p class="mt-2 text-sm font-medium">ไม่พบรายการคำขอเบิกตามเงื่อนไขที่เลือก</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted/40 text-xs">
					<Table.Row>
						<Table.Head>เลขตั๋วคำขอ</Table.Head>
						<Table.Head>มื้อ / เมนูอาหาร</Table.Head>
						<Table.Head>เวลาที่ส่งคำขอ</Table.Head>
						<Table.Head>รายการเบิก</Table.Head>
						<Table.Head>สถานะ</Table.Head>
						<Table.Head class="text-right">การจัดการ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body class="text-xs">
					{#each filteredRequisitions as req (req._id)}
						{@const plan = req.meal_plan_id ? planById[req.meal_plan_id] : null}
						<Table.Row class="hover:bg-muted/30">
							<Table.Cell class="font-mono font-bold text-foreground">
								{req.ticket_no}
							</Table.Cell>
							<Table.Cell>
								<div class="font-medium text-foreground">
									{plan?.label ?? 'มื้ออาหารทั่วไป'}
								</div>
								{#if plan}
									<div class="text-2xs text-muted-foreground">
										{plan.date} · {MEAL_PERIOD_LABELS[plan.meal]}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{formatThaiDateTime(req.requested_at ?? req.created_at) || '—'}
							</Table.Cell>
							<Table.Cell>
								<span class="font-medium text-foreground">{req.items.length} รายการอาหาร</span>
								{#if req.gas_drawdown && req.gas_drawdown.length > 0}
									<span class="ml-1 inline-flex items-center text-orange-600">
										<Flame class="mr-0.5 h-3 w-3" />
										{req.gas_drawdown.length} ถัง
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if req.status === 'approved'}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 font-semibold text-green-800"
									>
										<CheckCircle2 class="h-3 w-3 text-green-600" />
										อนุมัติแล้ว
									</span>
								{:else if req.status === 'rejected'}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 font-semibold text-rose-800"
									>
										<XCircle class="h-3 w-3 text-rose-600" />
										ปฏิเสธ
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-semibold text-amber-800"
									>
										<Clock class="h-3 w-3 text-amber-600" />
										รอตรวจสอบ
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button
									variant={req.status === 'pending' ? 'default' : 'outline'}
									size="sm"
									class="h-7 gap-1 text-xs"
									onclick={() => openInspection(req)}
								>
									<Eye class="h-3.5 w-3.5" />
									{req.status === 'pending' ? 'ตรวจสอบตั๋ว' : 'ดูรายละเอียด'}
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>
</div>

<!-- Inspection & Approval Dialog -->
<Dialog.Root bind:open={inspectionDialogOpen}>
	<Dialog.Content class="max-h-[90vh] sm:max-w-4xl">
		{#if inspectingTicket}
			{@const plan = inspectingTicket.meal_plan_id ? planById[inspectingTicket.meal_plan_id] : null}
			<Dialog.Header>
				<div class="flex items-center justify-between">
					<div>
						<Dialog.Title class="flex items-center gap-2 font-mono text-lg font-bold">
							{inspectingTicket.ticket_no}
							{#if inspectingTicket.status === 'pending'}
								<span class="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
									รอคลังตรวจสอบ
								</span>
							{:else if inspectingTicket.status === 'approved'}
								<span class="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
									อนุมัติแล้ว
								</span>
							{:else}
								<span class="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
									ถูกปฏิเสธ
								</span>
							{/if}
						</Dialog.Title>
						<Dialog.Description class="text-xs text-muted-foreground">
							ขอเบิกเมื่อ: {formatThaiDateTime(
								inspectingTicket.requested_at ?? inspectingTicket.created_at
							) || '—'}
							{#if plan}
								· สำหรับ: {plan.label ?? 'เมนูอาหาร'} ({plan.date} {MEAL_PERIOD_LABELS[plan.meal]})
							{/if}
						</Dialog.Description>
					</div>
				</div>
			</Dialog.Header>

			<div class="max-h-[60vh] space-y-4 overflow-y-auto py-2 text-xs">
				<!-- If rejected, show reason -->
				{#if inspectingTicket.status === 'rejected'}
					<div class="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
						<div class="flex items-center gap-2 font-bold">
							<XCircle class="h-4 w-4 text-rose-600" />
							เหตุผลที่ปฏิเสธคำขอ:
						</div>
						<p class="mt-1 text-xs">{inspectingTicket.reject_reason || '—'}</p>
					</div>
				{/if}

				<!-- Section 1: Food Items Table / Cards -->
				<div class="rounded-lg border">
					<div class="border-b bg-muted/40 px-3 py-2 font-semibold text-foreground">
						รายการวัตถุดิบ ({inspectingTicket.items.length} รายการ)
					</div>

					<!-- Desktop Table View -->
					<div class="hidden sm:block">
						<Table.Root>
							<Table.Header class="text-2xs">
								<Table.Row>
									<Table.Head class="w-[28%] min-w-[160px]">วัตถุดิบ</Table.Head>
									<Table.Head class="w-[18%] text-right whitespace-nowrap">ยอดขอเบิก</Table.Head>
									<Table.Head class="w-[20%] text-right whitespace-nowrap">คงเหลือในคลัง</Table.Head
									>
									<Table.Head class="w-[34%] min-w-[220px] text-right whitespace-nowrap"
										>ยอดตัดจ่าย (Issued)</Table.Head
									>
								</Table.Row>
							</Table.Header>
							<Table.Body class="text-xs">
								{#each inspectingTicket.items as item (item.item_id)}
									{@const onHand = stock.data?.get(item.item_id) ?? '0'}
									{@const isShort = qtyGt(item.qty_requested, onHand)}
									{@const itemName = getItemName(item.item_id)}
									<Table.Row>
										<Table.Cell>
											<div class="font-medium text-foreground">{itemName}</div>
										</Table.Cell>
										<Table.Cell class="text-right font-mono font-medium text-foreground">
											{item.qty_requested}
											{item.unit}
										</Table.Cell>
										<Table.Cell
											class="text-right font-mono {isShort
												? 'font-bold text-rose-600'
												: 'text-muted-foreground'}"
										>
											<div class="font-bold text-foreground">{onHand} {item.unit}</div>
											{#if isShort}
												<span class="block text-2xs font-normal text-rose-500">สต็อกไม่พอ</span>
											{/if}
										</Table.Cell>
										<Table.Cell class="text-right">
											{#if inspectingTicket.status === 'pending'}
												<div class="flex items-center justify-end gap-1.5">
													<Input
														type="number"
														step="0.01"
														min="0"
														bind:value={partialIssueMap[item.item_id]}
														class="h-8 w-28 text-right font-mono text-xs"
													/>
													<span class="w-7 text-left font-mono text-xs text-muted-foreground"
														>{item.unit}</span
													>
												</div>
											{:else}
												<span class="font-mono font-bold text-foreground">
													{item.qty_issued}
													{item.unit}
												</span>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>

					<!-- Mobile Vertical Card View -->
					<div class="block divide-y sm:hidden">
						{#each inspectingTicket.items as item (item.item_id)}
							{@const onHand = stock.data?.get(item.item_id) ?? '0'}
							{@const isShort = qtyGt(item.qty_requested, onHand)}
							{@const itemName = getItemName(item.item_id)}
							<div class="space-y-2.5 p-3">
								<div class="flex items-start justify-between gap-2">
									<div class="text-sm font-medium text-foreground">{itemName}</div>
									<div class="font-mono text-xs whitespace-nowrap text-muted-foreground">
										ขอเบิก: <strong class="text-foreground">{item.qty_requested} {item.unit}</strong
										>
									</div>
								</div>
								<div
									class="flex items-center justify-between border-t border-muted/50 pt-2 text-xs"
								>
									<div class="text-muted-foreground">
										คงเหลือ:
										<span
											class="font-mono font-bold {isShort ? 'text-rose-600' : 'text-foreground'}"
										>
											{onHand}
											{item.unit}
										</span>
										{#if isShort}
											<span class="block text-2xs font-normal text-rose-500">สต็อกไม่พอ</span>
										{/if}
									</div>
									<div class="flex items-center gap-1.5">
										<span class="text-2xs text-muted-foreground">ยอดจ่าย:</span>
										{#if inspectingTicket.status === 'pending'}
											<div class="flex items-center gap-1">
												<Input
													type="number"
													step="0.01"
													min="0"
													bind:value={partialIssueMap[item.item_id]}
													class="h-8 w-24 text-right font-mono text-xs"
												/>
												<span class="font-mono text-xs text-muted-foreground">{item.unit}</span>
											</div>
										{:else}
											<span class="font-mono font-bold text-foreground">
												{item.qty_issued}
												{item.unit}
											</span>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Section 2: Gas Drawdown Table / Cards -->
				{#if inspectingTicket.gas_drawdown && inspectingTicket.gas_drawdown.length > 0}
					<div class="rounded-lg border">
						<div
							class="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2 font-semibold text-foreground"
						>
							<Flame class="h-3.5 w-3.5 text-orange-600" />
							การเบิกใช้แก๊สหุงต้ม LPG ({inspectingTicket.gas_drawdown.length} รายการ)
						</div>

						<!-- Desktop Table View -->
						<div class="hidden sm:block">
							<Table.Root>
								<Table.Header class="text-2xs">
									<Table.Row>
										<Table.Head class="w-[28%] min-w-[160px]">ถังแก๊ส</Table.Head>
										<Table.Head class="w-[18%] text-right whitespace-nowrap"
											>ยอดใช้ประเมิน</Table.Head
										>
										<Table.Head class="w-[20%] text-right whitespace-nowrap"
											>คงเหลือในถัง</Table.Head
										>
										<Table.Head class="w-[34%] min-w-[220px] text-right whitespace-nowrap"
											>ถังที่จ่ายจริง</Table.Head
										>
									</Table.Row>
								</Table.Header>
								<Table.Body class="text-xs">
									{#each inspectingTicket.gas_drawdown as gas (gas.cylinder_id)}
										{@const reqCyl = (gasTypes.data ?? []).find((t) => t._id === gas.cylinder_id)}
										{@const selectedCylId = switchedGasMap[gas.cylinder_id] ?? gas.cylinder_id}
										{@const actualCyl = (gasTypes.data ?? []).find((t) => t._id === selectedCylId)}
										{@const remaining = actualCyl
											? gasCylinderBalance(
													gasLedger.data ?? [],
													selectedCylId,
													actualCyl.capacity_kg
												)
											: '0'}
										{@const isGasShort = qtyGt(gas.qty_kg, remaining)}
										<Table.Row>
											<Table.Cell class="font-medium">
												<div>{reqCyl?.name ?? gas.cylinder_id}</div>
											</Table.Cell>
											<Table.Cell class="text-right font-mono font-medium text-foreground">
												{gas.qty_kg} kg
											</Table.Cell>
											<Table.Cell
												class="text-right font-mono {isGasShort
													? 'font-bold text-rose-600'
													: 'text-muted-foreground'}"
											>
												<div class="font-bold text-foreground">{remaining} kg</div>
												{#if actualCyl}
													<div class="text-2xs font-normal text-muted-foreground">
														(ความจุ {actualCyl.capacity_kg} kg)
													</div>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-right">
												{#if inspectingTicket.status === 'pending'}
													<select
														value={switchedGasMap[gas.cylinder_id] ?? gas.cylinder_id}
														onchange={(e) => {
															switchedGasMap[gas.cylinder_id] = e.currentTarget.value;
															switchedGasMap = { ...switchedGasMap };
														}}
														class="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
													>
														{#each gasTypes.data ?? [] as opt (opt._id)}
															{@const optBal = gasCylinderBalance(
																gasLedger.data ?? [],
																opt._id,
																opt.capacity_kg
															)}
															<option value={opt._id}>
																{opt.name} ({opt.capacity_kg} kg · เหลือ {optBal} kg)
															</option>
														{/each}
													</select>
												{:else}
													<span class="font-medium">
														{actualCyl?.name ?? gas.cylinder_id}
													</span>
												{/if}
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>

						<!-- Mobile Vertical Card View -->
						<div class="block divide-y sm:hidden">
							{#each inspectingTicket.gas_drawdown as gas (gas.cylinder_id)}
								{@const reqCyl = (gasTypes.data ?? []).find((t) => t._id === gas.cylinder_id)}
								{@const selectedCylId = switchedGasMap[gas.cylinder_id] ?? gas.cylinder_id}
								{@const actualCyl = (gasTypes.data ?? []).find((t) => t._id === selectedCylId)}
								{@const remaining = actualCyl
									? gasCylinderBalance(gasLedger.data ?? [], selectedCylId, actualCyl.capacity_kg)
									: '0'}
								{@const isGasShort = qtyGt(gas.qty_kg, remaining)}
								<div class="space-y-2.5 p-3">
									<div class="flex items-start justify-between gap-2">
										<div>
											<div class="text-sm font-medium text-foreground">
												{reqCyl?.name ?? gas.cylinder_id}
											</div>
											<div class="mt-0.5 text-2xs text-muted-foreground">
												ยอดใช้ประเมิน: <strong class="text-foreground">{gas.qty_kg} kg</strong>
											</div>
										</div>
										<div class="text-right">
											<div
												class="font-mono text-xs font-bold {isGasShort
													? 'text-rose-600'
													: 'text-foreground'}"
											>
												คงเหลือ {remaining} kg
											</div>
											{#if actualCyl}
												<div class="text-2xs text-muted-foreground">
													(ความจุ {actualCyl.capacity_kg} kg)
												</div>
											{/if}
										</div>
									</div>

									{#if inspectingTicket.status === 'pending'}
										<div class="space-y-1 border-t border-muted/50 pt-2">
											<label
												for={`cyl-mobile-${gas.cylinder_id}`}
												class="block text-2xs font-medium text-muted-foreground"
											>
												ถังที่จ่ายจริง:
											</label>
											<select
												id={`cyl-mobile-${gas.cylinder_id}`}
												value={switchedGasMap[gas.cylinder_id] ?? gas.cylinder_id}
												onchange={(e) => {
													switchedGasMap[gas.cylinder_id] = e.currentTarget.value;
													switchedGasMap = { ...switchedGasMap };
												}}
												class="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
											>
												{#each gasTypes.data ?? [] as opt (opt._id)}
													{@const optBal = gasCylinderBalance(
														gasLedger.data ?? [],
														opt._id,
														opt.capacity_kg
													)}
													<option value={opt._id}>
														{opt.name} ({opt.capacity_kg} kg · เหลือ {optBal} kg)
													</option>
												{/each}
											</select>
										</div>
									{:else}
										<div
											class="flex items-center justify-between border-t border-muted/50 pt-2 text-xs"
										>
											<span class="text-muted-foreground">ถังที่จ่ายจริง:</span>
											<span class="font-medium">{actualCyl?.name ?? gas.cylinder_id}</span>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Section 3: Audit Info if Approved -->
				{#if inspectingTicket.status === 'approved'}
					<div
						class="space-y-2 rounded-lg border border-green-200 bg-green-50/70 p-3.5 text-xs text-green-950"
					>
						<div class="flex items-center gap-2 font-bold text-green-800">
							<CheckCircle2 class="h-4 w-4 text-green-600" />
							อนุมัติตัดจ่ายสต็อกแล้ว
						</div>
						<div
							class="grid grid-cols-1 gap-2 border-t border-green-200/60 pt-1 text-xs text-muted-foreground sm:grid-cols-2"
						>
							<div>
								<span class="text-muted-foreground/80">อนุมัติโดย:</span>
								<span class="font-medium text-foreground"
									>{inspectingTicket.approved_by ?? '—'}</span
								>
							</div>
							<div>
								<span class="text-muted-foreground/80">เมื่อ:</span>
								<span class="font-medium text-foreground"
									>{formatThaiDateTime(inspectingTicket.approved_at) || '—'}</span
								>
							</div>
						</div>
						<div class="pt-1 text-xs">
							<span class="text-muted-foreground">เลขอ้างอิงตัดสต็อกคลัง (Stock Ledger ID):</span>
							{#if inspectingTicket.ledger_ids && inspectingTicket.ledger_ids.length > 0}
								<div class="mt-1 flex flex-wrap gap-1.5">
									{#each inspectingTicket.ledger_ids as ledgerId (ledgerId)}
										<code
											class="rounded border border-green-200 bg-white/80 px-2 py-0.5 font-mono text-2xs font-medium text-green-900 select-all"
										>
											{ledgerId}
										</code>
									{/each}
								</div>
							{:else}
								<span class="ml-1 font-mono text-xs text-muted-foreground">—</span>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<Dialog.Footer
				class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"
			>
				<Button
					variant="outline"
					class="w-full sm:w-auto"
					onclick={() => (inspectionDialogOpen = false)}>ปิด</Button
				>

				{#if inspectingTicket.status === 'pending'}
					<div
						class="flex w-full flex-col-reverse items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center"
					>
						<Button
							variant="outline"
							class="w-full text-destructive hover:bg-destructive/10 sm:w-auto"
							onclick={openRejectDialog}
							disabled={approveMutation.isPending || rejectMutation.isPending}
						>
							<XCircle class="mr-1 h-3.5 w-3.5" />
							ปฏิเสธคำขอ
						</Button>
						<Button
							class="w-full gap-1 bg-green-600 text-white hover:bg-green-700 sm:w-auto"
							onclick={handleApprove}
							disabled={approveMutation.isPending || rejectMutation.isPending}
						>
							<Check class="h-3.5 w-3.5" />
							{approveMutation.isPending ? 'กำลังอนุมัติ...' : 'อนุมัติจ่ายและตัดสต็อก'}
						</Button>
					</div>
				{/if}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Reject Reason Prompt Dialog -->
<Dialog.Root bind:open={rejectDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base font-bold text-destructive">
				ปฏิเสธคำขอเบิกวัตถุดิบโรงครัว
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				กรุณาระบุเหตุผลการปฏิเสธคำขอเบิก เพื่อให้โรงครัวแก้ไขแผนและส่งคำขอใหม่
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-2">
			<Label for="reject-reason" class="text-xs">เหตุผลการปฏิเสธ (จำเป็น)</Label>
			<Textarea
				id="reject-reason"
				bind:value={rejectReasonText}
				placeholder="เช่น วัตถุดิบบางรายการขาดสต็อก, แก๊สไม่เพียงพอ..."
				rows={3}
				class="mt-1 text-xs"
			/>
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => (rejectDialogOpen = false)}>ยกเลิก</Button>
			<Button variant="destructive" onclick={handleReject} disabled={rejectMutation.isPending}>
				{rejectMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธคำขอ'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
