<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type { DistributionRequest, DistributionBatch } from '../domain/distribution';
	import {
		buildApprovalPlan,
		validateApprovalPlan,
		buildApprovalAllocations,
		type ItemAllocationPlan
	} from './approval-allocation-form';
	import PhysicalLotSelector from './physical-lot-selector.svelte';
	import { useApproveDistributionRequest } from '../application/queries';
	import {
		useLedger,
		projectStockLotBalances,
		StockLotIntegrityError,
		type StockLotBalance
	} from '$lib/features/operations';
	import { useItemMasters, type ItemMaster } from '$lib/features/catalog';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isWarehouseStaff, isSystemAdmin } from '$lib/auth/roles';

	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Info from '@lucide/svelte/icons/info';
	import Layers from '@lucide/svelte/icons/layers';
	import Sparkles from '@lucide/svelte/icons/sparkles';

	interface Props {
		open: boolean;
		request: DistributionRequest | null;
		onSuccess?: (batch: DistributionBatch) => void;
		onClose?: () => void;
	}

	let { open = $bindable(false), request, onSuccess, onClose }: Props = $props();

	const userRoles = $derived(authStore.user?.roles ?? []);
	const canApprove = $derived(isWarehouseStaff(userRoles) || isSystemAdmin(userRoles));

	import { SvelteMap } from 'svelte/reactivity';

	// 1. Authorized, on-demand stock ledger query
	const ledgerQuery = useLedger(() => open && canApprove && !!request);

	// 2. Catalog item masters for display names
	const itemMastersQuery = useItemMasters(() => request?.shelter_code ?? '');

	const itemMastersMap = $derived.by(() => {
		const map = new SvelteMap<string, ItemMaster>();
		for (const item of itemMastersQuery.data ?? []) {
			map.set(item._id, item);
		}
		return map;
	});

	// 3. State for user lot quantity inputs: lot_ref -> input value string
	let lotInputMap = $state<Record<string, string>>({});
	let isSubmitting = $state(false);

	// 4. Project physical lot balances with integrity protection
	const lotProjectionResult = $derived.by<{
		lots: StockLotBalance[];
		integrityError?: string;
	}>(() => {
		if (!ledgerQuery.data) return { lots: [] };
		try {
			const projected = projectStockLotBalances(ledgerQuery.data);
			return { lots: projected };
		} catch (err) {
			if (err instanceof StockLotIntegrityError) {
				return { lots: [], integrityError: err.message };
			}
			return {
				lots: [],
				integrityError: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการคำนวณข้อมูล Lot'
			};
		}
	});

	const availableLots = $derived(lotProjectionResult.lots);
	const integrityError = $derived(lotProjectionResult.integrityError);

	// 5. Allocation plans and full validation (enforcing both per-item and global lot capacity)
	const plans = $derived.by<ItemAllocationPlan[]>(() => {
		if (!request) return [];
		return buildApprovalPlan(request, lotInputMap, availableLots);
	});

	const validation = $derived.by(() => validateApprovalPlan(plans, availableLots));

	// 6. Mutation hook
	const approveMutation = useApproveDistributionRequest();

	function handleLotQtyChange(inputKey: string, value: string) {
		lotInputMap = {
			...lotInputMap,
			[inputKey]: value
		};
	}

	function handleRefreshStock() {
		ledgerQuery.refetch();
		toast.info('กำลังตรวจสอบยอดคงเหลือล่าสุด...');
	}

	function handleClose() {
		if (isSubmitting) return;
		open = false;
		lotInputMap = {};
		onClose?.();
	}

	async function handleApprove() {
		if (isSubmitting) return;

		if (!request) {
			toast.error('ไม่พบข้อมูลคำร้องที่ต้องการอนุมัติ');
			return;
		}

		if (request.status !== 'pending') {
			toast.error(
				`ไม่สามารถอนุมัติได้เนื่องจากคำร้องไม่อยู่ในสถานะรอดำเนินการ (สถานะ: ${request.status})`
			);
			return;
		}

		if (!canApprove) {
			toast.error('คุณไม่มีสิทธิ์ในการอนุมัติคำร้องเบิกจ่าย (เฉพาะเจ้าหน้าที่คลังหรือผู้ดูแลระบบ)');
			return;
		}

		if (integrityError) {
			toast.error(`ไม่สามารถอนุมัติได้เนื่องจากความไม่ถูกต้องของข้อมูลคลัง: ${integrityError}`);
			return;
		}

		if (!validation.isValid) {
			toast.error(validation.errors[0] ?? 'กรุณาตรวจสอบจำนวนที่จัดสรรให้ถูกต้อง');
			return;
		}

		const allocations = buildApprovalAllocations(plans, availableLots);
		if (allocations.length === 0) {
			toast.error('ต้องมีรายการจัดสรรจำนวนอย่างน้อย 1 รายการ');
			return;
		}

		const userName = authStore.user?.name;
		if (!userName) {
			toast.error('ไม่พบข้อมูลผู้ใช้งานที่เข้าสู่ระบบ');
			return;
		}

		const ctx = {
			shelterCode: request.shelter_code,
			createdBy: userName,
			roles: userRoles
		};

		isSubmitting = true;
		try {
			const batch = await approveMutation.mutateAsync({
				requestId: request._id,
				allocations,
				ctx
			});

			toast.success(
				validation.isPartial
					? 'อนุมัติคำร้อง (บางส่วน) และสร้างชุดเบิกจ่ายเรียบร้อยแล้ว'
					: 'อนุมัติคำร้องครบถ้วน และสร้างชุดเบิกจ่ายเรียบร้อยแล้ว'
			);

			open = false;
			lotInputMap = {};
			onSuccess?.(batch);
		} catch (err) {
			// Authoritative failure handling without fake local state transition.
			// Error message remains operationally safe without assuming rollback.
			const errorMsg =
				err instanceof Error
					? err.message
					: 'ไม่สามารถยืนยันผลการอนุมัติได้ กรุณาตรวจสอบสถานะคำร้องและสต็อกอีกครั้ง';
			toast.error(errorMsg);
			// Refetch latest stock to resolve any potential conflict
			ledgerQuery.refetch();
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog bind:open onOpenChange={(v) => !v && handleClose()}>
	<DialogContent class="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
		<!-- Header -->
		<DialogHeader class="shrink-0 bg-primary p-5 text-primary-foreground">
			<div class="flex items-center justify-between">
				<div class="space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<Badge variant="outline" class="border-white/20 bg-white/10 text-[10px] text-white">
							{request?.shelter_code ?? 'Shelter'}
						</Badge>
						<span class="font-mono text-[11px] break-all text-white/80">
							{request?._id ?? ''}
						</span>
					</div>
					<DialogTitle class="flex items-center gap-2 text-base font-bold text-white">
						<PackageCheck class="size-5 text-white/80" />
						คัดเลือก Physical Lot เพื่ออนุมัติเบิกจ่าย
					</DialogTitle>
				</div>
			</div>
		</DialogHeader>

		<!-- Body (Scrollable) -->
		<div class="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
			<!-- Non-mutating open disclaimer -->
			<div
				class="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-blue-900"
			>
				<Info class="mt-0.5 size-4 shrink-0 text-blue-600" />
				<div>
					<p class="font-bold">การเปิดหน้าต่างนี้เป็นขั้นตอนคัดเลือก Lot เท่านั้น</p>
					<p class="mt-0.5 text-[11px] text-blue-700">
						สถานะคำร้องยังคงเป็น <code>pending</code> และจะไม่มีการตัดสต็อกหรือสร้าง Batch จนกว่าจะกด
						"ยืนยันการอนุมัติ"
					</p>
				</div>
			</div>

			<!-- Non-pending status alert if authoritative state changed -->
			{#if request && request.status !== 'pending'}
				<div
					class="flex items-center gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900"
				>
					<AlertTriangle class="size-4 shrink-0 text-amber-600" />
					<div>
						<p class="font-bold">
							คำร้องนี้ไม่อยู่ในสถานะรอดำเนินการ (สถานะปัจจุบัน: {request.status})
						</p>
						<p class="mt-0.5 text-[11px] text-amber-700">
							ไม่สามารถอนุมัติได้เนื่องจากคำร้องได้รับการประมวลผลหรือยกเลิกแล้ว
						</p>
					</div>
				</div>
			{/if}

			<!-- Request Context Details -->
			{#if request}
				<div
					class="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-700 sm:grid-cols-4"
				>
					<div>
						<span class="block text-[10px] text-slate-400">วัตถุประสงค์</span>
						<strong class="text-xs text-slate-800">{request.purpose}</strong>
					</div>
					<div>
						<span class="block text-[10px] text-slate-400">ผู้ร้องขอ</span>
						<strong class="text-xs text-slate-800">{request.requested_by}</strong>
					</div>
					<div>
						<span class="block text-[10px] text-slate-400">ยอดผู้พักพิงอ้างอิง</span>
						<strong class="text-xs text-slate-800">{request.active_headcount_snapshot} คน</strong>
					</div>
					<div>
						<span class="block text-[10px] text-slate-400">Buffer เผื่อเหลือ</span>
						<strong class="text-xs text-slate-800">+{request.buffer_percent}%</strong>
					</div>
				</div>
			{/if}

			<!-- Stock Ledger Status / Conflict Refresh Bar -->
			<div
				class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-2.5"
			>
				<div class="flex items-center gap-2 text-slate-600">
					<Layers class="size-4 shrink-0 text-slate-400" />
					<span>
						{#if ledgerQuery.isLoading}
							กำลังโหลดข้อมูลคลังสินค้า...
						{:else if integrityError}
							<span class="font-bold text-red-600"
								>⚠ ตรวจพบความผิดปกติของข้อมูลคลัง: {integrityError}</span
							>
						{:else}
							พบ {availableLots.length} Physical Lots ที่มีสินค้าคงเหลือ
						{/if}
					</span>
				</div>
				<Button
					variant="outline"
					size="sm"
					onclick={handleRefreshStock}
					disabled={ledgerQuery.isLoading || isSubmitting}
					class="h-7 gap-1 text-xs"
				>
					<RefreshCw class="size-3 {ledgerQuery.isLoading ? 'animate-spin' : ''}" />
					โหลดข้อมูลล่าสุด
				</Button>
			</div>

			<!-- Requested Items and Lot Selectors -->
			<div class="space-y-3">
				<h3 class="flex items-center gap-1.5 text-xs font-bold text-slate-800">
					<Sparkles class="size-3.5 text-primary" />
					รายการสิ่งของที่ร้องขอ ({plans.length} รายการ)
				</h3>

				{#each plans as plan (plan.item_id)}
					{@const master = itemMastersMap.get(plan.item_id)}
					{@const displayName = master?.name ?? plan.item_id}

					<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
						<!-- Item Header -->
						<div
							class="flex flex-col justify-between gap-2 border-b border-slate-100 pb-2.5 sm:flex-row sm:items-center"
						>
							<div class="flex flex-wrap items-center gap-2">
								<strong class="text-sm text-slate-800">{displayName}</strong>
								<span class="text-xs text-slate-400">
									(ร้องขอ: <strong>{plan.requested_qty} {plan.unit}</strong>)
								</span>
								<Badge variant="secondary" class="text-[10px]">
									{plan.distribution_type_snapshot === 'consumable'
										? 'บริโภคต่อเนื่อง'
										: 'แจกครั้งเดียว'}
								</Badge>
							</div>

							<!-- Item Allocation Status Badge -->
							<div>
								{#if plan.status === 'full'}
									<Badge
										class="gap-1 border-emerald-300 bg-emerald-100 text-[11px] font-bold text-emerald-800"
									>
										<CheckCircle2 class="size-3 text-emerald-600" />
										จัดสรรครบถ้วน: {plan.allocated_qty} / {plan.requested_qty}
										{plan.unit}
									</Badge>
								{:else if plan.status === 'partial'}
									<Badge class="border-blue-300 bg-blue-100 text-[11px] font-bold text-blue-800">
										จัดสรรบางส่วน: {plan.allocated_qty} / {plan.requested_qty}
										{plan.unit} (ขาด {plan.remaining_qty})
									</Badge>
								{:else if plan.status === 'over'}
									<Badge class="gap-1 border-red-300 bg-red-100 text-[11px] font-bold text-red-800">
										<AlertTriangle class="size-3 text-red-600" />
										เกินคำร้อง: {plan.allocated_qty} / {plan.requested_qty}
										{plan.unit}
									</Badge>
								{:else}
									<Badge variant="outline" class="text-[11px] text-slate-500">
										ยังไม่ได้จัดสรร (0 / {plan.requested_qty}
										{plan.unit})
									</Badge>
								{/if}
							</div>
						</div>

						<!-- Physical Lot Breakdown for this item -->
						<PhysicalLotSelector
							{plan}
							{lotInputMap}
							disabled={isSubmitting || ledgerQuery.isLoading}
							onLotQtyChange={handleLotQtyChange}
						/>

						{#if plan.errorMessage}
							<div
								class="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] font-bold text-red-700"
							>
								<AlertTriangle class="size-3.5 shrink-0 text-red-600" />
								<span>{plan.errorMessage}</span>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<!-- Footer -->
		<DialogFooter
			class="flex shrink-0 flex-col items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:flex-row"
		>
			<!-- Overall Summary -->
			<div class="w-full space-y-0.5 text-left text-xs text-slate-600 sm:w-auto">
				<div class="flex items-center gap-2">
					<span>ยอดจัดสรรรวม:</span>
					<strong class="text-sm font-extrabold text-slate-900"
						>{validation.totalAllocatedQty} หน่วย</strong
					>
					<span class="text-slate-400">({validation.positiveAllocationsCount} รายการจัดสรร)</span>
				</div>
				<div>
					{#if validation.isValid}
						{#if validation.isPartial}
							<span class="font-bold text-blue-700"
								>ℹ ผลลัพธ์: อนุมัติจัดสรรบางส่วน (Partial Allocation)</span
							>
						{:else}
							<span class="font-bold text-emerald-700"
								>✓ ผลลัพธ์: อนุมัติจัดสรรครบถ้วนตามคำร้อง (Full Allocation)</span
							>
						{/if}
					{:else}
						<span class="font-bold text-amber-700"
							>{validation.errors[0] ?? 'กรุณากรอกจำนวนที่ต้องการจัดสรร'}</span
						>
					{/if}
				</div>
			</div>

			<!-- Actions -->
			<div class="flex w-full items-center justify-end gap-2 sm:w-auto">
				<Button
					variant="outline"
					onclick={handleClose}
					disabled={isSubmitting}
					class="px-4 text-xs font-semibold"
				>
					ยกเลิก
				</Button>

				<Button
					onclick={handleApprove}
					disabled={isSubmitting ||
						!validation.isValid ||
						ledgerQuery.isLoading ||
						!!integrityError ||
						!canApprove ||
						request?.status !== 'pending'}
					class="gap-1.5 px-5 text-xs font-bold"
				>
					{#if isSubmitting}
						<RefreshCw class="size-3.5 animate-spin" />
						กำลังอนุมัติ...
					{:else}
						<CheckCircle2 class="size-3.5" />
						ยืนยันการอนุมัติ
					{/if}
				</Button>
			</div>
		</DialogFooter>
	</DialogContent>
</Dialog>
