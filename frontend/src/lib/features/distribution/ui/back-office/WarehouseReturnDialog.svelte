<script lang="ts">
	import type { RequisitionTicket } from '../../domain/food-supplies';
	import { useReceiveWarehouseReturns } from '../../application/queries';
	import { getReturnableBadgeLabel, getReturnableBadgeClass } from '../model/catalog-eligibility';
	import {
		initializeVerifiedQuantities,
		validateVerifiedQuantity,
		validateWarehouseReturnForm,
		computeWarehouseReturnSummary,
		buildVerifiedReturnsPayload
	} from '../model/warehouse-return';
	import { formatDistributionError } from '../model/distribution-error';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import Check from '@lucide/svelte/icons/check';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	interface Props {
		open: boolean;
		ticket: RequisitionTicket;
		shelterCode: string;
		onSuccess?: () => void;
		onClose: () => void;
	}

	let { open = $bindable(false), ticket, shelterCode, onSuccess, onClose }: Props = $props();

	const receiveMutation = useReceiveWarehouseReturns();

	let verifiedValues = $state<Record<string, string>>({});
	let formErrors = $state<Record<string, string>>({});

	function handleVerifiedQtyBlur(itemId: string) {
		const item = ticket.items.find((candidate) => candidate.item_id === itemId);
		if (!item) return;
		validateVerifiedQuantity(verifiedValues[itemId] ?? '', item.returned_qty ?? '0');
	}

	function resetForm() {
		verifiedValues = initializeVerifiedQuantities(ticket.items);
		formErrors = {};
	}

	$effect(() => {
		if (open && ticket) {
			resetForm();
		}
	});

	function handleMatchDeclared() {
		verifiedValues = initializeVerifiedQuantities(ticket.items);
		formErrors = {};
	}

	const summary = $derived(computeWarehouseReturnSummary(ticket.items, verifiedValues));

	const isSubmitting = $derived(receiveMutation.isPending);
	const canSubmit = $derived(
		summary.isValid && !isSubmitting && ticket.status === 'RETURN_PENDING_RECEIPT'
	);

	function handleQtyInput(itemId: string, value: string) {
		verifiedValues = {
			...verifiedValues,
			[itemId]: value
		};
		// Clear per-field error upon edit
		if (formErrors[itemId]) {
			const next = { ...formErrors };
			delete next[itemId];
			formErrors = next;
		}
	}

	async function handleSubmit() {
		for (const item of ticket.items) {
			handleVerifiedQtyBlur(item.item_id);
		}
		const validation = validateWarehouseReturnForm(ticket.items, verifiedValues);
		if (!validation.isValid || !validation.normalizedValues) {
			formErrors = validation.errors;
			toast.error('กรุณาตรวจสอบจำนวนตรวจรับให้ถูกต้องทุกรายการ');
			return;
		}

		try {
			const result = await receiveMutation.mutateAsync({
				ticketId: ticket._id,
				options: buildVerifiedReturnsPayload(validation.normalizedValues),
				shelterCode
			});

			const ledgerMsg =
				result.ledgerEntriesCreated > 0
					? ` (บันทึกรับเข้าคลัง ${result.ledgerEntriesCreated} รายการ)`
					: '';
			toast.success(
				`ตรวจรับของคืนสำหรับใบเบิกจ่าย ${ticket.ticket_no} สำเร็จ${ledgerMsg} (สถานะ: ตรวจรับคืนแล้ว)`
			);
			open = false;
			onSuccess?.();
		} catch (err) {
			// Preserve verified values and form state on error (Prompt §13)
			const msg = formatDistributionError(
				err,
				'เกิดข้อผิดพลาดในการตรวจรับของคืนเข้าคลังสินค้า กรุณาลองใหม่อีกครั้ง'
			);
			toast.error(msg);
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (!next) {
			resetForm();
			onClose();
		}
	}}
>
	<Dialog.Content
		class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[720px] lg:max-w-[840px]"
	>
		<!-- Header -->
		<div class="border-b border-slate-200/80 bg-white px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
					<PackageCheck class="h-5 w-5 text-[#0A2647]" />
					<span>ตรวจรับของคืนเข้าคลังสินค้า</span>
				</Dialog.Title>
				<Dialog.Description class="text-xs text-slate-500">
					ตรวจสอบและบันทึกจำนวนของที่ได้รับคืนจริง ณ ท่ารับของคลังสินค้าสำหรับใบเบิกจ่าย <strong
						class="font-mono text-slate-700">{ticket.ticket_no}</strong
					>
				</Dialog.Description>
			</Dialog.Header>

			<!-- Physical Authority Notice -->
			<div
				class="mt-3 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-950"
			>
				<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
				<div>
					<strong>การยืนยันนี้มีผลต่อสต็อกคงคลังจริง</strong>
					<p class="mt-0.5 text-sky-900/80">
						ระบบจะบันทึกเพิ่มยอดเข้าสต็อกคลังสินค้าตามจำนวนที่ตรวจรับจริงเท่านั้น
						จำนวนที่ตรวจรับต้องไม่เกินยอดที่จุดแจกแจ้งส่งคืน
					</p>
				</div>
			</div>
		</div>

		<!-- Body: Items List -->
		<div class="flex-1 space-y-4 overflow-y-auto p-6">
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-slate-700">
					รายการสินค้าที่ต้องตรวจรับ ({ticket.items.length} รายการ)
				</span>
				<Button
					type="button"
					variant="link"
					onclick={handleMatchDeclared}
					class="h-auto p-0 text-xs font-semibold"
				>
					<Check class="h-3.5 w-3.5" />
					<span>รับครบตามที่จุดแจกแจ้งทั้งหมด</span>
				</Button>
			</div>

			<div class="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-2xs">
				<table class="w-full min-w-[640px] text-left text-sm">
					<thead
						class="border-b border-slate-200 bg-slate-50/75 text-2xs font-semibold tracking-wider text-slate-600 uppercase"
					>
						<tr>
							<th scope="col" class="py-2.5 pr-2 pl-4">ชื่อรายการ</th>
							<th scope="col" class="px-2 py-2.5 text-center">ประเภท</th>
							<th scope="col" class="px-2 py-2.5 text-right">จัดสรร</th>
							<th scope="col" class="px-2 py-2.5 text-right">แจกจ่าย</th>
							<th scope="col" class="px-2 py-2.5 text-right text-sky-800">จุดแจกส่งคืน</th>
							<th scope="col" class="px-2 py-2.5 text-right font-bold text-[#0A2647]">
								ตรวจรับจริง *
							</th>
							<th scope="col" class="py-2.5 pr-4 pl-2 text-right">ผลต่าง (ตกหล่น)</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each summary.itemPreviews as preview (preview.itemId)}
							{@const item = ticket.items.find((i) => i.item_id === preview.itemId)}
							<tr class="hover:bg-slate-50/50">
								<!-- Item Details -->
								<td class="py-3 pr-2 pl-4">
									<div class="font-bold text-slate-900">{preview.itemName}</div>
									<div class="font-mono text-2xs text-slate-400">ID: {preview.itemId}</div>
								</td>

								<!-- Type Badge -->
								<td class="px-2 py-3 text-center">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold {getReturnableBadgeClass(
											item?.returnable
										)}"
									>
										{getReturnableBadgeLabel(item?.returnable)}
									</span>
								</td>

								<!-- Allocated -->
								<td class="px-2 py-3 text-right text-xs font-medium text-slate-600 tabular-nums">
									{preview.allocated}
								</td>

								<!-- Distributed -->
								<td class="px-2 py-3 text-right text-xs font-medium text-slate-600 tabular-nums">
									{preview.distributed}
								</td>

								<!-- Frontline Declared Returned -->
								<td class="px-2 py-3 text-right text-xs font-bold text-sky-800 tabular-nums">
									{preview.frontlineReturned}
								</td>

								<!-- Verified Returned Input -->
								<td class="px-2 py-3 text-right">
									<div class="inline-flex flex-col items-end">
										<Input
											type="text"
											inputmode="numeric"
											step="1"
											min="0"
											disabled={isSubmitting}
											value={verifiedValues[preview.itemId] ?? ''}
											onblur={() => handleVerifiedQtyBlur(preview.itemId)}
											oninput={(e) =>
												handleQtyInput(preview.itemId, (e.target as HTMLInputElement).value)}
											aria-label={`จำนวนตรวจรับจริง ${preview.itemName}`}
											aria-invalid={!preview.isValid || !!formErrors[preview.itemId]}
											class="h-9 w-24 text-right text-xs font-bold tabular-nums {preview.isValid &&
											!formErrors[preview.itemId]
												? 'border-slate-200 bg-white text-slate-900 focus-visible:ring-slate-900'
												: 'border-red-300 bg-red-50/50 text-red-900 focus-visible:ring-red-500'}"
										/>
										{#if formErrors[preview.itemId] || preview.error}
											<span class="mt-1 text-right text-2xs font-semibold text-red-600">
												{formErrors[preview.itemId] ?? preview.error}
											</span>
										{/if}
									</div>
								</td>

								<!-- Discrepancy -->
								<td class="py-3 pr-4 pl-2 text-right">
									{#if preview.hasDiscrepancy}
										<span
											class="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800 tabular-nums"
										>
											+{preview.discrepancy}
										</span>
									{:else}
										<span
											class="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 tabular-nums"
										>
											0 (ครบถ้วน)
										</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Accounting Summary Cards -->
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
					<div class="text-2xs font-semibold text-slate-500 uppercase">ยอดเบิกทั้งหมด</div>
					<div class="mt-1 font-mono text-base font-bold text-slate-900 tabular-nums">
						{summary.totalAllocated}
					</div>
				</div>

				<div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
					<div class="text-2xs font-semibold text-slate-500 uppercase">ยอดแจกจ่ายแล้ว</div>
					<div class="mt-1 font-mono text-base font-bold text-slate-700 tabular-nums">
						{summary.totalDistributed}
					</div>
				</div>

				<div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
					<div class="text-2xs font-semibold text-emerald-800 uppercase">ตรวจรับเข้าคลังจริง</div>
					<div class="mt-1 font-mono text-base font-bold text-emerald-900 tabular-nums">
						{summary.totalVerifiedReturned}
					</div>
				</div>

				<div
					class="rounded-xl border p-3 {summary.hasDiscrepancy
						? 'border-amber-300 bg-amber-50/60'
						: 'border-slate-200 bg-slate-50/70'}"
				>
					<div
						class="text-2xs font-semibold uppercase {summary.hasDiscrepancy
							? 'text-amber-800'
							: 'text-slate-500'}"
					>
						ผลต่างสูญหาย / ไม่ได้รับ
					</div>
					<div
						class="mt-1 font-mono text-base font-bold tabular-nums {summary.hasDiscrepancy
							? 'text-amber-900'
							: 'text-slate-700'}"
					>
						{summary.totalDiscrepancy}
					</div>
				</div>
			</div>

			<!-- Discrepancy Notice if any -->
			{#if summary.hasDiscrepancy}
				<div
					class="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-950"
				>
					<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
					<div>
						<strong>พบผลต่างของที่ตกหล่นจำนวน {summary.totalDiscrepancy} ชิ้น</strong>
						<p class="mt-0.5 text-amber-900">
							จำนวนที่ตกหล่นจะไม่ถูกบันทึกเพิ่มเข้าสต็อกคลังสินค้า
							และจะถูกบันทึกเป็นยอดผลต่างในประวัติการเบิกจ่ายของตั๋วใบนี้
						</p>
					</div>
				</div>
			{/if}
		</div>

		<!-- Footer Actions -->
		<div
			class="flex items-center justify-between border-t border-slate-200 bg-slate-50/75 px-6 py-4"
		>
			<Button
				type="button"
				variant="outline"
				onclick={() => {
					open = false;
					onClose();
				}}
				class="text-xs font-semibold"
			>
				ยกเลิก
			</Button>

			<Button
				type="button"
				variant="default"
				onclick={handleSubmit}
				disabled={!canSubmit}
				class="text-xs font-semibold hover:bg-primary-dark"
			>
				{#if isSubmitting}
					<Loader2 class="h-4 w-4 animate-spin" />
					<span>กำลังบันทึกตรวจรับ...</span>
				{:else}
					<PackageCheck class="h-4 w-4" />
					<span>ยืนยันตรวจรับเข้าสต็อกคลัง</span>
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
