<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Archive from '@lucide/svelte/icons/archive';
	import X from '@lucide/svelte/icons/x';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Layers from '@lucide/svelte/icons/layers';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Play from '@lucide/svelte/icons/play';
	import { ulid } from '$lib/db/ulid';
	import { qtyLte } from '$lib/utils/qty';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import type {
		BulkReturnPool,
		BulkReturnClaim,
		DistributionLog
	} from '../../domain/food-supplies';
	import {
		useBulkReturnPools,
		useBulkReturnPool,
		useClearLoanViaBulkPool,
		useReturnOperationState,
		useAbortAbandonedReturnReservation
	} from '../../application/queries';
	import {
		calculateLoanRemainingQty,
		isEligibleBulkPool,
		validateBulkGateClear,
		validateBulkForwardRecovery,
		getReturnReservationModeLabel
	} from '../model/loan-return';
	import { getBulkPoolStatusLabel } from '../model/bulk-pool-manager';
	import { dialogAccessibility } from '../model/dialog-accessibility';
	import { formatDistributionError } from '../model/distribution-error';

	interface Props {
		open?: boolean;
		log: DistributionLog | null;
		itemName?: string;
		shelterCode?: string;
		canClearLoan?: boolean;
		onsuccess?: (data: {
			log: DistributionLog;
			pool: BulkReturnPool;
			claim: BulkReturnClaim;
		}) => void;
		onclose?: () => void;
	}

	let {
		open = $bindable(false),
		log,
		itemName = '',
		shelterCode,
		canClearLoan = true,
		onsuccess,
		onclose
	}: Props = $props();

	const bulkClaimMutation = useClearLoanViaBulkPool();
	const abortMutation = useAbortAbandonedReturnReservation();

	const operationStateQuery = useReturnOperationState(
		() => log?._id,
		() => shelterCode,
		() => Boolean(open && log?._id)
	);
	const operationState = $derived(operationStateQuery.data);

	let lastInitializedLogId = $state<string | null>(null);
	let hydratedOperationId = $state<string | null>(null);
	let operationUlid = $state<string>(ulid());
	// '' is the explicit "no pool selected yet" UI state — RadioGroup.Root's bind:value cannot
	// accept `undefined` (its Bits UI primitive declares a non-undefined $bindable fallback and
	// throws props_invalid_value if bound to undefined).
	let selectedPoolId = $state<string>('');
	let localError = $state<string | null>(null);

	// Derived metrics from authoritative log
	const previousReturned = $derived(log?.qty_returned ?? '0');
	const remainingQty = $derived(log ? calculateLoanRemainingQty(log) : '0');

	const isCrossModeCollision = $derived(
		Boolean(
			operationState?.reservation &&
			(operationState.phase === 'PRE_EFFECT_ABORTABLE' ||
				operationState.phase === 'IRREVERSIBLE_FORWARD_ONLY') &&
			operationState.reservation.mode !== 'BULK'
		)
	);

	const isForwardRecovery = $derived(
		Boolean(
			operationState?.phase === 'IRREVERSIBLE_FORWARD_ONLY' &&
			operationState.reservation?.mode === 'BULK'
		)
	);

	// Query pools matching the item in this shelter for NEW operations (ACTIVE only)
	const poolsQuery = useBulkReturnPools(
		() => (log?.item_id ? { item_id: log.item_id, status: 'ACTIVE' } : undefined),
		() => shelterCode,
		() => Boolean(open && log?.item_id)
	);

	const allPools = $derived(poolsQuery.data ?? []);
	// Filter candidate pools: matching item, status ACTIVE, and unclaimed_quota > 0
	const candidatePools = $derived(
		allPools.filter((p) => isEligibleBulkPool(p, log?.item_id ?? ''))
	);
	const selectedPool = $derived(candidatePools.find((p) => p._id === selectedPoolId) ?? null);

	// In FORWARD RECOVERY mode, query the exact persisted pool (even if EXHAUSTED)
	const recoveryPoolId = $derived(
		isForwardRecovery && operationState?.reservation?.mode === 'BULK'
			? (operationState.reservation.bulk_pool_id ?? operationState.claim?.bulk_pool_id ?? null)
			: null
	);

	const recoveryPoolQuery = useBulkReturnPool(
		() => recoveryPoolId ?? '',
		() => shelterCode,
		() => Boolean(open && isForwardRecovery && recoveryPoolId)
	);

	const effectivePool = $derived(
		isForwardRecovery ? (recoveryPoolQuery.data ?? selectedPool) : selectedPool
	);

	const displayPools = $derived(
		isForwardRecovery && effectivePool && !candidatePools.some((p) => p._id === effectivePool._id)
			? [effectivePool, ...candidatePools]
			: candidatePools
	);

	const validation = $derived(
		isForwardRecovery
			? validateBulkForwardRecovery({
					pool: effectivePool,
					expectedItemId: log?.item_id ?? '',
					isLoading: Boolean(recoveryPoolQuery.isLoading)
				})
			: validateBulkGateClear(selectedPool, remainingQty)
	);

	// Reset form only when opening a new dialog session or switching to a different loan record,
	// strictly preserving operator input and error message across retryable mutation failures.
	// When active reservation in BULK mode exists, adopt persisted durable intent asynchronously once.
	$effect(() => {
		if (!open || !log) {
			lastInitializedLogId = null;
			hydratedOperationId = null;
			return;
		}

		if (lastInitializedLogId !== log._id) {
			lastInitializedLogId = log._id;
			hydratedOperationId = null;
			operationUlid = ulid();
			selectedPoolId = '';
			localError = null;
		}

		const res = operationState?.reservation;
		if (
			res &&
			res.mode === 'BULK' &&
			(operationState?.phase === 'PRE_EFFECT_ABORTABLE' ||
				operationState?.phase === 'IRREVERSIBLE_FORWARD_ONLY')
		) {
			if (hydratedOperationId !== res.operation_id) {
				operationUlid = res.operation_id;
				if (res.bulk_pool_id) {
					selectedPoolId = res.bulk_pool_id;
				} else if (operationState?.claim?.bulk_pool_id) {
					selectedPoolId = operationState.claim.bulk_pool_id;
				}
				hydratedOperationId = res.operation_id;
			}
		}
	});

	// Auto-select single eligible pool if exactly one has sufficient capacity
	$effect(() => {
		if (open && !selectedPoolId && candidatePools.length > 0) {
			const sufficient = candidatePools.filter((p) => qtyLte(remainingQty, p.unclaimed_quota));
			if (sufficient.length === 1) {
				selectedPoolId = sufficient[0]._id;
			}
		}
	});

	const canClose = $derived(
		!bulkClaimMutation.isPending && !abortMutation.isPending && !isForwardRecovery
	);

	function performClose() {
		open = false;
		localError = null;
		onclose?.();
	}

	function requestClose() {
		// Guarded user dismissal: blocked while mutation is in-flight or in forward recovery
		if (!canClose) return;
		performClose();
	}

	function closeAfterSuccess() {
		// Authoritative workflow completion: closes deterministically without depending
		// on cached return-operation-state query invalidation timing.
		performClose();
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		localError = null;

		if (!log) {
			localError = 'ไม่พบข้อมูลรายการยืม';
			return;
		}

		if (isCrossModeCollision) {
			localError = `รายการนี้กำลังถูกดำเนินการด้วยวิธี "${getReturnReservationModeLabel(operationState?.reservation?.mode)}" โดย ${operationState?.reservation?.operation_by ?? 'ไม่ระบุ'} ไม่อนุญาตให้ทำรายการซ้อนข้ามวิธี`;
			return;
		}

		if (!canClearLoan) {
			localError =
				'คุณไม่มีสิทธิ์ในการเคลียร์รายการยืมที่จุดรวมคืน (ต้องการสิทธิ์เจ้าหน้าที่ส่วนหน้า/ผู้ประสานงาน/ผู้จัดการศูนย์)';
			return;
		}

		if (!effectivePool) {
			localError = 'กรุณาเลือกจุดรวมคืน (Bulk Return Pool) ที่ต้องการเคลียร์';
			return;
		}

		if (!validation.isValid) {
			localError = validation.error ?? 'ข้อมูลที่ระบุไม่ถูกต้อง';
			return;
		}

		// Snapshot immutable submission values before await to protect against
		// reactive races if loan context changes before the mutation resolves.
		const submitted = {
			logId: log._id,
			poolId: effectivePool._id,
			operationUlid,
			ticketId: log.ticket_id,
			itemName: itemName || log.item_id,
			remainingQty
		};

		try {
			const result = await bulkClaimMutation.mutateAsync({
				input: {
					logId: submitted.logId,
					poolId: submitted.poolId,
					operationUlid: submitted.operationUlid,
					notes: 'Resolved at gate via bulk return pool'
				},
				shelterCode,
				ticketId: submitted.ticketId
			});

			const successMsg = `เคลียร์รายการจากจุดรวมคืนสำเร็จ: ${submitted.itemName} (ตัดยอดคงค้าง ${submitted.remainingQty} ชิ้น · หักโควตาจากคลังรวม)`;

			toast.success(successMsg);
			onsuccess?.(result);
			closeAfterSuccess();
		} catch (err) {
			localError = formatDistributionError(
				err,
				'ไม่สามารถเคลียร์รายการจากจุดรวมคืนได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}

	async function handleAbortAndRestart() {
		if (!log) return;
		localError = null;
		try {
			await abortMutation.mutateAsync({
				logId: log._id,
				shelterCode,
				ticketId: log.ticket_id
			});
			operationUlid = ulid();
			hydratedOperationId = null;
			selectedPoolId = '';
			toast.info('ยกเลิกรายการเดิมที่ค้างอยู่แล้ว เริ่มต้นรายการใหม่');
		} catch (err) {
			localError = formatDistributionError(
				err,
				'ไม่สามารถยกเลิกรายการเดิมได้ กรุณาลองใหม่อีกครั้ง'
			);
		}
	}
</script>

{#if open && log}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop dismissal surface -->
		<button
			type="button"
			tabindex="-1"
			aria-hidden="true"
			class="fixed inset-0 cursor-default border-0 bg-black/40 backdrop-blur-xs outline-none"
			onclick={() => {
				if (canClose) {
					requestClose();
				}
			}}
		></button>

		<!-- Dialog panel/container -->
		<div
			class="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl transition-all"
			role="dialog"
			aria-modal="true"
			aria-labelledby="bulk-gate-clear-dialog-title"
			aria-describedby="bulk-gate-clear-dialog-desc"
			tabindex="-1"
			use:dialogAccessibility={{
				canClose: () => canClose,
				onClose: requestClose
			}}
		>
			<!-- Dialog Header -->
			<div class="flex items-start justify-between border-b border-slate-100 pb-4">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl border border-purple-200 bg-purple-50 text-purple-700 shadow-2xs"
					>
						<Archive class="h-5 w-5" />
					</div>
					<div>
						<h2 id="bulk-gate-clear-dialog-title" class="text-base font-bold text-slate-900">
							เคลียร์รายการจากจุดรวมคืน
						</h2>
						<p id="bulk-gate-clear-dialog-desc" class="text-xs text-slate-500">
							{itemName || log.item_id} · รหัสรายการ: <span class="font-mono">{log._id}</span>
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={requestClose}
					disabled={!canClose}
					class="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="ปิดหน้าต่าง"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Critical Invariant Warning Callout (Zero-Second-Restock) -->
			<div
				class="mt-4 flex items-start gap-2.5 rounded-xl border border-purple-200 bg-purple-50/80 p-3 text-xs text-purple-950"
				role="note"
			>
				<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
				<div>
					<p class="font-bold">หักโควตาจากคลังรวมคืน</p>
					<p class="mt-0.5 text-2xs text-purple-900">
						รายการนี้จะใช้ของที่ถูกส่งคืนเข้าจุดรวบรวมไว้แล้วเพื่อเคลียร์ภาระการยืมของผู้ประสบภัย
						<strong>โดยไม่มีการรับของคืนเข้าคลังสินค้าซ้ำ และไม่เพิ่มสต็อกซ้ำ</strong>
					</p>
				</div>
			</div>

			<!-- Authoritative In-Flight Recovery Callout (CR-134 R4) -->
			{#if isCrossModeCollision}
				<div
					class="mt-3 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-950"
					role="alert"
				>
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
					<div>
						<p class="font-bold">
							รายการนี้กำลังถูกดำเนินการด้วยวิธีอื่นอยู่ ({getReturnReservationModeLabel(
								operationState?.reservation?.mode
							)})
						</p>
						<p class="mt-0.5 text-2xs text-red-800">
							ผู้ทำรายการ: <strong>{operationState?.reservation?.operation_by ?? 'ไม่ระบุ'}</strong>
							ไม่อนุญาตให้ทำรายการซ้อนข้ามวิธี กรุณาใช้หน้าต่างสำหรับ {getReturnReservationModeLabel(
								operationState?.reservation?.mode
							)} หรือรอจนกว่ารายการเดิมจะสิ้นสุด
						</p>
					</div>
				</div>
			{:else if operationState?.phase === 'PRE_EFFECT_ABORTABLE'}
				<div
					class="mt-3 flex items-start justify-between gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"
					role="status"
				>
					<div class="flex items-start gap-2">
						<RotateCcw class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
						<div>
							<p class="font-bold">พบรายการที่ค้างอยู่ ยังทำไม่เสร็จ</p>
							<p class="mt-0.5 text-2xs text-amber-800">
								วิธี: <strong
									>{getReturnReservationModeLabel(operationState.reservation?.mode)}</strong
								>
								· ผู้ทำรายการ:
								<strong
									>{operationState.reservation?.operation_by ??
										operationState.reservation?.created_by ??
										'ไม่ระบุ'}</strong
								>
								· คุณสามารถทำรายการต่อ หรือยกเลิกรายการเพื่อเริ่มต้นใหม่
							</p>
						</div>
					</div>
					{#if operationState.canAbort}
						<button
							type="button"
							onclick={handleAbortAndRestart}
							disabled={abortMutation.isPending || bulkClaimMutation.isPending}
							class="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-2xs font-bold text-amber-900 shadow-2xs hover:bg-amber-100 disabled:opacity-50"
						>
							{#if abortMutation.isPending}
								<Loader class="inline h-3 w-3 animate-spin" />
							{:else}
								ยกเลิกและเริ่มใหม่
							{/if}
						</button>
					{/if}
				</div>
			{:else if operationState?.phase === 'IRREVERSIBLE_FORWARD_ONLY'}
				<div
					class="mt-3 flex items-start gap-2.5 rounded-xl border border-blue-300 bg-blue-50 p-3 text-xs text-blue-950"
					role="status"
				>
					<Play class="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
					<div>
						<p class="font-bold">รายการนี้หักโควตาไปแล้ว ไม่สามารถยกเลิกได้</p>
						<p class="mt-0.5 text-2xs text-blue-800">
							ข้อมูลของรายการเดิมถูกล็อกไว้ไม่ให้แก้ไข กรุณากด "ทำรายการต่อ"
							เพื่อปิดรายการให้เสร็จสมบูรณ์
						</p>
					</div>
				</div>
			{/if}

			<!-- Dialog Body Form -->
			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<!-- Loan Balance Summary Box -->
				<div
					class="grid grid-cols-3 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-center"
				>
					<div>
						<p class="text-2xs font-semibold text-slate-500 uppercase">ยืมไปทั้งหมด</p>
						<p class="text-sm font-bold text-slate-800">{log.qty} ชิ้น</p>
					</div>
					<div>
						<p class="text-2xs font-semibold text-slate-500 uppercase">คืนแล้วสะสม</p>
						<p class="text-sm font-bold text-slate-700">{previousReturned} ชิ้น</p>
					</div>
					<div class="rounded-lg bg-purple-50 p-1">
						<p class="text-2xs font-bold text-purple-700 uppercase">ยอดที่ต้องเคลียร์</p>
						<p class="text-sm font-extrabold text-purple-800">{remainingQty} ชิ้น</p>
					</div>
				</div>

				<!-- Pool Selection Group -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<label
							for="bulk-pool-selection"
							class="text-2xs font-bold tracking-wider text-slate-700 uppercase"
						>
							เลือกจุดรวมคืน (Bulk Return Pool) <span class="text-red-500">*</span>
						</label>
						{#if poolsQuery.isPending}
							<span class="inline-flex items-center gap-1 text-2xs text-slate-400">
								<Loader class="h-3 w-3 animate-spin" /> กำลังโหลด...
							</span>
						{/if}
					</div>

					{#if poolsQuery.isPending}
						<div
							class="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-6 text-xs text-slate-500"
						>
							<Loader class="h-4 w-4 animate-spin text-purple-600" />
							<span>กำลังค้นหาจุดรวบรวมของคืนที่พร้อมใช้งาน...</span>
						</div>
					{:else if poolsQuery.isError}
						<div
							class="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
							role="alert"
						>
							<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
							<div>
								<p class="font-bold">ไม่สามารถดึงข้อมูลจุดรวมคืนได้</p>
								<p class="text-2xs text-red-700">
									{formatDistributionError(
										poolsQuery.error,
										'กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง'
									)}
								</p>
							</div>
						</div>
					{:else if displayPools.length === 0}
						<div
							class="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-4 text-center text-xs text-amber-900"
						>
							<Layers class="mb-1.5 h-6 w-6 text-amber-500" />
							<p class="font-bold">ไม่พบจุดรวบรวมของคืนที่มีโควตาคงเหลือ</p>
							<p class="mt-0.5 text-2xs text-amber-700">
								ไม่มีกองของคืนรวมสำหรับสินค้านี้ที่มีสถานะ ACTIVE หรือมีโควตาเหลืออยู่
								กรุณาใช้วิธีรับคืนที่เคาน์เตอร์ปกติ
							</p>
						</div>
					{:else}
						<RadioGroup.Root
							id="bulk-pool-selection"
							bind:value={selectedPoolId}
							class="max-h-56 space-y-2 overflow-y-auto pr-1"
						>
							{#each displayPools as pool (pool._id)}
								{@const isRecoveryPool = isForwardRecovery && effectivePool?._id === pool._id}
								{@const isSelected = selectedPoolId === pool._id || isRecoveryPool}
								{@const hasEnoughQuota = isRecoveryPool
									? true
									: qtyLte(remainingQty, pool.unclaimed_quota)}

								<label
									for="bulk-pool-{pool._id}"
									class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border p-3 transition-all {isSelected
										? isRecoveryPool
											? 'border-blue-600 bg-blue-50/50 shadow-2xs ring-1 ring-blue-600'
											: 'border-purple-600 bg-purple-50/50 shadow-2xs ring-1 ring-purple-600'
										: hasEnoughQuota
											? 'border-slate-200 bg-white hover:border-slate-300'
											: 'border-slate-200/60 bg-slate-50/60 opacity-60'}"
								>
									<div class="flex items-start gap-2.5">
										<RadioGroup.Item
											value={pool._id}
											id="bulk-pool-{pool._id}"
											disabled={bulkClaimMutation.isPending ||
												(!hasEnoughQuota && !isRecoveryPool) ||
												!canClearLoan ||
												isForwardRecovery ||
												isCrossModeCollision}
											class="mt-1"
										/>
										<div class="space-y-0.5">
											<div class="flex items-center gap-1.5">
												<span class="font-mono text-xs font-bold text-slate-900">
													{pool._id.replace('bulk_return_pool:', 'POOL-')}
												</span>
												<span
													class="py-0.2 rounded-full border px-1.5 text-3xs font-bold {isRecoveryPool
														? 'border-blue-300 bg-blue-100 text-blue-900'
														: 'border-purple-200 bg-purple-50 text-purple-800'}"
												>
													{getBulkPoolStatusLabel(pool.status)}
												</span>
												{#if isRecoveryPool}
													<span
														class="rounded-full border border-blue-200 bg-blue-50 px-1.5 text-3xs font-bold text-blue-700"
													>
														จุดรวมคืนเดิม
													</span>
												{/if}
											</div>
											{#if pool.notes}
												<p class="text-2xs text-slate-500">{pool.notes}</p>
											{/if}
											<div class="flex items-center gap-3 pt-1 text-2xs text-slate-500">
												<span>รับรวม: <strong>{pool.total_received_qty}</strong></span>
												<span>เคลียร์แล้ว: <strong>{pool.claimed_qty}</strong></span>
												<span
													class="font-bold {isRecoveryPool
														? 'text-blue-700'
														: hasEnoughQuota
															? 'text-purple-700'
															: 'text-amber-700'}"
												>
													โควตาเหลือ: {pool.unclaimed_quota} ชิ้น
												</span>
											</div>
										</div>
									</div>

									{#if isRecoveryPool}
										<span
											class="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-3xs font-bold text-blue-800"
										>
											รายการกู้คืน
										</span>
									{:else if !hasEnoughQuota}
										<span
											class="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-3xs font-bold text-amber-800"
										>
											โควตาไม่พอ ({pool.unclaimed_quota} &lt; {remainingQty})
										</span>
									{:else if isSelected}
										<CheckCircle2 class="h-4 w-4 shrink-0 text-purple-600" />
									{/if}
								</label>
							{/each}
						</RadioGroup.Root>
					{/if}
				</div>

				<!-- Local Error Banner -->
				{#if localError}
					<div
						class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
						role="alert"
					>
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
						<div class="flex-1">
							<p class="font-bold">เกิดข้อผิดพลาด</p>
							<p class="text-2xs text-red-700">{localError}</p>
						</div>
					</div>
				{/if}

				<!-- Dialog Actions -->
				<div class="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
					<button
						type="button"
						onclick={requestClose}
						disabled={!canClose}
						class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						ยกเลิก
					</button>

					<button
						type="submit"
						disabled={bulkClaimMutation.isPending ||
							!validation.isValid ||
							!canClearLoan ||
							isCrossModeCollision}
						class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-purple-600 bg-purple-600 px-4 py-2 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if bulkClaimMutation.isPending}
							<Loader class="h-3.5 w-3.5 animate-spin" />
							<span>กำลังหักโควตาจุดรวมคืน...</span>
						{:else if operationState?.phase === 'IRREVERSIBLE_FORWARD_ONLY'}
							<Play class="h-3.5 w-3.5" />
							<span>ทำรายการต่อ</span>
						{:else if operationState?.phase === 'PRE_EFFECT_ABORTABLE'}
							<Play class="h-3.5 w-3.5" />
							<span>ทำรายการค้างต่อ</span>
						{:else}
							<Archive class="h-3.5 w-3.5" />
							<span>ยืนยันเคลียร์รายการ ({remainingQty} ชิ้น)</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
