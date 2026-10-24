<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { StoragePointSelect, useStoragePoints } from '$lib/features/operations';
	import { createStableOperationId, useReceiveBulkReturnPool } from '../../application/queries';
	import type { BulkReturnPoolDiscrepancyReason } from '../../domain/food-supplies';
	import { formatDistributionError } from '../model/distribution-error';
	import {
		DISCREPANCY_REASON_OPTIONS,
		discrepancyReasonLabel,
		buildReceiveInput,
		initReceiveLines,
		isLineMismatched,
		validateReceiveLines
	} from '../model/bulk-return-lifecycle';
	import {
		LATE_ENTRY_GUIDANCE,
		resolveItemDisplay,
		type BulkReturnPoolRow,
		type PoolCatalogItem
	} from '../model/bulk-return-pool-v3';

	/**
	 * Warehouse receive form for a SUBMITTED pool. Lines come from the submit snapshot
	 * (`pool.items_summary`), never from the live row items. The parent mounts it only while visible,
	 * so the form starts fresh every time it is opened.
	 */
	interface Props {
		open: boolean;
		row: BulkReturnPoolRow;
		catalog: readonly PoolCatalogItem[];
		shelterCode: string;
	}

	let { open = $bindable(false), row, catalog, shelterCode }: Props = $props();

	const receiveMutation = useReceiveBulkReturnPool();
	const storagePoints = useStoragePoints(() => shelterCode);

	// Initial values only: the form is a draft and must not follow later pool updates.
	let lines = $state(initReceiveLines(untrack(() => row.pool.items_summary ?? [])));
	let storagePointId = $state('');
	let attempted = $state(false);
	let submitError = $state<string | null>(null);
	// One ULID per receive action; reused when the confirm is retried after a failure.
	let receiveUlid: string | null = null;

	const validation = $derived(
		validateReceiveLines(lines, { storagePointId, points: storagePoints.points })
	);
	const pointsExist = $derived(storagePoints.points.length > 0);
	const lateCount = $derived(row.late_entries.length);

	function handleOpenChange(next: boolean) {
		if (!next && receiveMutation.isPending) return;
		if (!next) receiveUlid = null;
		open = next;
	}

	async function handleSubmit() {
		if (storagePoints.isLoading) return;
		attempted = true;
		submitError = null;
		if (!validation.isValid) return;

		const point = storagePoints.points.find((p) => p.id === storagePointId) ?? null;
		receiveUlid ??= createStableOperationId();
		try {
			const result = await receiveMutation.mutateAsync({
				poolId: row.pool._id,
				input: buildReceiveInput(lines, point),
				operationUlid: receiveUlid,
				shelterCode
			});
			receiveUlid = null;
			toast.success(result.replayed ? 'กองนี้ตรวจรับไว้แล้ว' : 'ตรวจรับเรียบร้อย ยอดเข้าคลังแล้ว');
			open = false;
		} catch (err) {
			const message = formatDistributionError(err, 'ตรวจรับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			submitError = message;
			toast.error(message);
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-[640px]">
		<div class="border-b border-slate-100 bg-slate-50 px-6 pt-6 pb-4">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2.5 text-lg font-bold text-slate-900">
					<span
						class="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-2xs"
					>
						<PackageCheck class="h-5 w-5" aria-hidden="true" />
					</span>
					<span>ตรวจรับกอง</span>
				</Dialog.Title>
				<Dialog.Description class="mt-1 text-sm text-slate-600">
					นับของที่ได้รับจริงของกอง "{row.pool.name}" เมื่อยืนยันแล้ว
					ยอดที่รับจริงจะถูกบันทึกเข้าคลัง
				</Dialog.Description>
			</Dialog.Header>
		</div>

		<form
			class="flex min-h-0 flex-1 flex-col"
			onsubmit={(event) => {
				event.preventDefault();
				void handleSubmit();
			}}
		>
			<div class="flex-1 space-y-5 overflow-y-auto p-6">
				{#if submitError}
					<div
						role="alert"
						class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-semibold text-red-900"
					>
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
						<p>{submitError}</p>
					</div>
				{/if}

				{#if lateCount > 0}
					<div
						class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900"
					>
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
						<p>
							มี <span class="font-semibold tabular-nums">{lateCount}</span>
							รายการเข้ามาหลังกองถูกส่งแล้ว (ค้าง) — ไม่รวมอยู่ในยอดที่ตรวจรับนี้ กรุณา{LATE_ENTRY_GUIDANCE}
						</p>
					</div>
				{/if}

				<ul class="space-y-3">
					{#each lines as line (line.item_id)}
						{@const item = resolveItemDisplay(line.item_id, catalog)}
						{@const errors = attempted ? validation.lineErrors[line.item_id] : undefined}
						{@const mismatched = isLineMismatched(line)}
						{@const qtyId = `receive-qty-${line.item_id}`}
						{@const reasonId = `receive-reason-${line.item_id}`}
						{@const noteId = `receive-note-${line.item_id}`}
						<li
							class="space-y-3 rounded-xl border p-3.5 shadow-2xs {mismatched
								? 'border-amber-200 bg-amber-50/40'
								: 'border-slate-200/80 bg-white'}"
						>
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="font-semibold break-words text-slate-900">{item.name}</span>
								<span class="text-sm text-slate-600">
									ยอดที่ส่งมา
									<span class="font-semibold text-slate-900 tabular-nums">
										{line.expected_qty}
										{item.unit}
									</span>
								</span>
							</div>

							<div class="space-y-1.5">
								<Label for={qtyId} class="text-sm font-semibold text-slate-700">
									จำนวนที่รับจริง <span class="text-red-600">*</span>
								</Label>
								<Input
									id={qtyId}
									bind:value={line.received_qty}
									inputmode="numeric"
									autocomplete="off"
									aria-label="จำนวนที่รับจริงของ {item.name}"
									aria-invalid={errors?.received_qty ? true : undefined}
									aria-describedby={errors?.received_qty ? `${qtyId}-error` : undefined}
									class="h-11 text-base tabular-nums sm:h-10 sm:text-sm"
								/>
								{#if errors?.received_qty}
									<p id="{qtyId}-error" role="alert" class="text-sm font-medium text-red-700">
										{errors.received_qty}
									</p>
								{/if}
							</div>

							{#if mismatched}
								<div class="space-y-1.5">
									<Label for={reasonId} class="text-sm font-semibold text-slate-700">
										เหตุผลของส่วนต่าง <span class="text-red-600">*</span>
									</Label>
									<Select.Root
										type="single"
										value={line.reason}
										onValueChange={(next) =>
											(line.reason = next as BulkReturnPoolDiscrepancyReason)}
									>
										<Select.Trigger
											id={reasonId}
											aria-label="เหตุผลของส่วนต่างของ {item.name}"
											aria-invalid={errors?.reason ? true : undefined}
											aria-describedby={errors?.reason ? `${reasonId}-error` : undefined}
											class="h-11 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm font-medium shadow-xs focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none data-[size=default]:h-11 sm:h-10 sm:data-[size=default]:h-10"
										>
											<span class="truncate">
												{line.reason ? discrepancyReasonLabel(line.reason) : 'เลือกเหตุผล'}
											</span>
										</Select.Trigger>
										<Select.Content>
											{#each DISCREPANCY_REASON_OPTIONS as option (option.value)}
												<Select.Item value={option.value} label={option.label} />
											{/each}
										</Select.Content>
									</Select.Root>
									{#if errors?.reason}
										<p id="{reasonId}-error" role="alert" class="text-sm font-medium text-red-700">
											{errors.reason}
										</p>
									{/if}
								</div>

								<div class="space-y-1.5">
									<Label for={noteId} class="text-sm font-semibold text-slate-700">
										รายละเอียด{#if line.reason === 'other'}
											<span class="text-red-600">*</span>
										{:else}
											(ไม่บังคับ)
										{/if}
									</Label>
									<Input
										id={noteId}
										bind:value={line.note}
										autocomplete="off"
										aria-label="รายละเอียดส่วนต่างของ {item.name}"
										aria-invalid={errors?.note ? true : undefined}
										aria-describedby={errors?.note ? `${noteId}-error` : undefined}
										class="h-11 text-base sm:h-10 sm:text-sm"
									/>
									{#if errors?.note}
										<p id="{noteId}-error" role="alert" class="text-sm font-medium text-red-700">
											{errors.note}
										</p>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>

				<div class="space-y-1.5">
					<Label for="receive-storage-point" class="text-sm font-semibold text-slate-700">
						จุดเก็บของที่รับเข้า{#if pointsExist}
							<span class="text-red-600">*</span>
						{/if}
					</Label>
					<StoragePointSelect
						id="receive-storage-point"
						points={storagePoints.points}
						bind:value={storagePointId}
						disabled={receiveMutation.isPending}
					/>
					{#if storagePoints.isLoading}
						<p class="text-xs text-slate-500">กำลังโหลดจุดเก็บของ...</p>
					{/if}
					{#if attempted && validation.storage}
						<p role="alert" class="text-sm font-medium text-red-700">{validation.storage}</p>
					{/if}
				</div>

				<p class="text-xs text-slate-500">
					ยอดเข้าคลังจะบันทึกตามจำนวนที่รับจริงเมื่อกดยืนยันตรวจรับ และแก้ไขภายหลังไม่ได้
				</p>
			</div>

			<div
				class="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"
			>
				<Button
					type="button"
					variant="outline"
					onclick={() => handleOpenChange(false)}
					disabled={receiveMutation.isPending}
					class="min-h-11 w-full sm:w-auto"
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					disabled={receiveMutation.isPending || storagePoints.isLoading}
					class="min-h-11 w-full gap-2 sm:w-auto"
				>
					{#if receiveMutation.isPending}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						<span>กำลังบันทึก...</span>
					{:else}
						<span>ยืนยันตรวจรับ</span>
					{/if}
				</Button>
			</div>
		</form>
	</Dialog.Content>
</Dialog.Root>
