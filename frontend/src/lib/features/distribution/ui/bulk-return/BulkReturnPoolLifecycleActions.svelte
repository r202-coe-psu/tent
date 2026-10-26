<script lang="ts">
	import { toast } from 'svelte-sonner';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { createStableOperationId, useSubmitBulkReturnPool } from '../../application/queries';
	import { formatDistributionError } from '../model/distribution-error';
	import {
		canSubmitPool,
		getSubmitBlockedReason,
		liveSummaryRows
	} from '../model/bulk-return-lifecycle';
	import type { BulkReturnPoolRow, PoolCatalogItem } from '../model/bulk-return-pool-v3';
	import BulkReturnPoolQrPrintDialog from './BulkReturnPoolQrPrintDialog.svelte';
	import ReceiveBulkReturnPoolDialog from './ReceiveBulkReturnPoolDialog.svelte';

	/**
	 * #660: "เก็บเข้าคลัง" (OPEN -> SUBMITTED) and "ตรวจรับ" (SUBMITTED -> RECEIVED) actions for the
	 * pool detail header. Renders nothing unless the viewer can manage pools.
	 */
	interface Props {
		row: BulkReturnPoolRow;
		catalog: readonly PoolCatalogItem[];
		shelterCode: string;
		/** canManageBulkReturnPool. */
		canManage: boolean;
	}

	let { row, catalog, shelterCode, canManage }: Props = $props();

	const submitMutation = useSubmitBulkReturnPool();

	let submitOpen = $state(false);
	let submitError = $state<string | null>(null);
	let receiveOpen = $state(false);
	let qrOpen = $state(false);
	// One ULID per submit action; reused when the confirm is retried after a failure.
	let submitUlid: string | null = null;

	const status = $derived(row.pool.status);
	const blockedReason = $derived(getSubmitBlockedReason(row));
	const summaryRows = $derived(liveSummaryRows(row, catalog));

	function handleSubmitOpenChange(next: boolean) {
		if (!next && submitMutation.isPending) return;
		if (!next) submitUlid = null;
		submitOpen = next;
	}

	async function confirmSubmit() {
		submitError = null;
		submitUlid ??= createStableOperationId();
		try {
			await submitMutation.mutateAsync({
				poolId: row.pool._id,
				operationUlid: submitUlid,
				shelterCode
			});
			submitUlid = null;
			toast.success('ส่งกองเข้าคลังแล้ว รอคลังตรวจรับ');
			submitOpen = false;
		} catch (err) {
			const message = formatDistributionError(err, 'เก็บเข้าคลังไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			submitError = message;
			toast.error(message);
		}
	}
</script>

{#if status === 'OPEN'}
	<Button
		type="button"
		variant="outline"
		onclick={() => (qrOpen = true)}
		class="min-h-11 w-full gap-2 sm:w-auto"
	>
		<QrCode class="h-4 w-4" aria-hidden="true" />
		พิมพ์ QR กอง
	</Button>
	{#if qrOpen}
		<BulkReturnPoolQrPrintDialog bind:open={qrOpen} pool={row.pool} />
	{/if}
{/if}

{#if canManage}
	{#if status === 'OPEN'}
		<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
			<Button
				type="button"
				variant="outline"
				disabled={!canSubmitPool(row)}
				aria-describedby={blockedReason ? 'submit-pool-reason' : undefined}
				onclick={() => {
					submitError = null;
					submitOpen = true;
				}}
				class="min-h-11 w-full gap-2 sm:w-auto"
			>
				<Warehouse class="h-4 w-4" aria-hidden="true" />
				เก็บเข้าคลัง
			</Button>
			{#if blockedReason}
				<p id="submit-pool-reason" class="text-xs text-slate-600">{blockedReason}</p>
			{/if}
		</div>

		<AlertDialog.Root open={submitOpen} onOpenChange={handleSubmitOpenChange}>
			<AlertDialog.Content class="grid-cols-[minmax(0,1fr)]">
				<AlertDialog.Header>
					<AlertDialog.Title>ยืนยันเก็บกองเข้าคลัง</AlertDialog.Title>
					<AlertDialog.Description>
						ยอดด้านล่างจะถูกสรุปส่งให้คลังตรวจรับ ชื่อและจุดเก็บของกองจะแก้ไขไม่ได้อีก
						รายการที่เข้ามาหลังจากนี้จะเป็น "ค้าง" และต้องย้ายไปกองอื่น
						ยังไม่ตัดเข้ายอดคลังจนกว่าจะตรวจรับ
					</AlertDialog.Description>
				</AlertDialog.Header>

				<div class="min-w-0 space-y-2">
					<p class="text-sm font-semibold [overflow-wrap:anywhere] text-slate-800">
						กอง "{row.pool.name}" ·
						<span class="tabular-nums">{row.entry_count}</span> รายการ
					</p>
					<ul class="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white">
						{#each summaryRows as summary (summary.item_id)}
							<li class="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-sm">
								<span class="min-w-0 font-medium [overflow-wrap:anywhere] text-slate-900"
									>{summary.name}</span
								>
								<span class="shrink-0 font-semibold text-slate-900 tabular-nums">
									{summary.qty}
									{summary.unit}
								</span>
							</li>
						{/each}
					</ul>
				</div>

				{#if submitError}
					<div
						role="alert"
						class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
					>
						<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
						<p class="min-w-0 [overflow-wrap:anywhere]">{submitError}</p>
					</div>
				{/if}

				<AlertDialog.Footer>
					<AlertDialog.Cancel disabled={submitMutation.isPending} class="min-h-11">
						ไม่ใช่ตอนนี้
					</AlertDialog.Cancel>
					<Button
						type="button"
						disabled={submitMutation.isPending || !canSubmitPool(row)}
						onclick={confirmSubmit}
						class="min-h-11 gap-2"
					>
						{#if submitMutation.isPending}
							<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						{/if}
						ยืนยันเก็บเข้าคลัง
					</Button>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Root>
	{:else if status === 'SUBMITTED'}
		<Button
			type="button"
			onclick={() => (receiveOpen = true)}
			class="min-h-11 w-full gap-2 sm:w-auto"
		>
			<PackageCheck class="h-4 w-4" aria-hidden="true" />
			ตรวจรับ
		</Button>

		{#if receiveOpen}
			<ReceiveBulkReturnPoolDialog bind:open={receiveOpen} {row} {catalog} {shelterCode} />
		{/if}
	{/if}
{/if}
