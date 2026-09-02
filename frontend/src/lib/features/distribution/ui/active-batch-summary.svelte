<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { useDistributionBatch } from '../application/queries';
	import { useItemMasters, type ItemMaster } from '$lib/features/catalog';
	import { getShelterCode } from '$lib/db/shelter';
	import type { DistributionBatchStatus } from '../domain/distribution';
	import { distributionBatchStatusLabels } from './request-ui';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import Boxes from '@lucide/svelte/icons/boxes';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Package from '@lucide/svelte/icons/package';
	import { SvelteMap } from 'svelte/reactivity';

	interface Props {
		batchId?: string;
		requestId?: string;
	}

	let { batchId, requestId }: Props = $props();
	const shelterCode = $derived(getShelterCode());

	const batchQuery = useDistributionBatch(
		() => batchId,
		() => shelterCode
	);
	const batch = $derived(batchQuery.data);

	const itemMastersQuery = useItemMasters(() => shelterCode);
	const itemMastersMap = $derived.by(() => {
		const map = new SvelteMap<string, ItemMaster>();
		for (const item of itemMastersQuery.data ?? []) {
			map.set(item._id, item);
		}
		return map;
	});

	const batchStatusBadges: Record<DistributionBatchStatus, string> = {
		activating:
			'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
		active:
			'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
		closing:
			'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
		closed:
			'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
	};

	function shortLotRef(ref: string): string {
		return ref.replace(/^stock_ledger:/, '').slice(0, 16);
	}

	function formatDate(value?: string): string {
		if (!value) return '-';
		try {
			return new Intl.DateTimeFormat('th-TH', {
				dateStyle: 'medium',
				timeStyle: 'short'
			}).format(new Date(value));
		} catch {
			return value;
		}
	}

	const isMismatch = $derived(!!batch && !!requestId && batch.request_id !== requestId);
</script>

<div class="space-y-4">
	{#if !batchId}
		<div
			class="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
		>
			<AlertTriangle class="size-4 shrink-0" />
			<span>ไม่พบรหัส Batch สำหรับคำร้องที่อนุมัตินี้</span>
		</div>
	{:else if batchQuery.isLoading}
		<div
			class="flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground"
		>
			<Loader2 class="size-5 animate-spin text-primary" />
			<span>กำลังโหลดข้อมูล Active Batch...</span>
		</div>
	{:else if batchQuery.isError || !batch}
		<div
			class="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
		>
			<AlertCircle class="size-4 shrink-0" />
			<span>ไม่สามารถโหลดข้อมูล Batch ได้</span>
		</div>
	{:else if isMismatch}
		<div
			class="flex items-center gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
		>
			<AlertTriangle class="size-4 shrink-0" />
			<span>
				ตรวจพบความไม่สอดคล้องของข้อมูล: รหัสคำร้องใน Batch ({batch.request_id}) ไม่ตรงกับคำร้องนี้ ({requestId})
			</span>
		</div>
	{:else}
		<!-- Authoritative Batch Card -->
		<Card.Root
			class="border-emerald-200/80 bg-emerald-50/30 shadow-xs dark:border-emerald-900/60 dark:bg-emerald-950/10"
		>
			<Card.Header class="p-4 pb-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<div
							class="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
						>
							<Boxes class="size-4" />
						</div>
						<div>
							<Card.Title class="text-sm font-bold text-foreground">
								ชุดการแจกจ่าย (Active Batch)
							</Card.Title>
							<Card.Description class="font-mono text-xs text-muted-foreground">
								{batch._id}
							</Card.Description>
						</div>
					</div>
					<Badge variant="outline" class={batchStatusBadges[batch.status]}>
						{distributionBatchStatusLabels[batch.status]}
					</Badge>
				</div>
			</Card.Header>

			<Card.Content class="space-y-4 p-4 pt-0 text-xs">
				<!-- Batch Meta Summary -->
				<div
					class="grid grid-cols-1 gap-2 rounded-lg border border-emerald-200/60 bg-white p-3 sm:grid-cols-2 dark:border-emerald-900/40 dark:bg-slate-950"
				>
					<div class="flex items-center gap-2 text-muted-foreground">
						<CheckCircle2 class="size-3.5 text-emerald-600 dark:text-emerald-400" />
						<span>ผู้เปิด Batch: <strong class="text-foreground">{batch.activated_by}</strong></span
						>
					</div>
					<div class="flex items-center gap-2 text-muted-foreground">
						<Clock class="size-3.5 text-emerald-600 dark:text-emerald-400" />
						<span
							>เปิดเมื่อ: <strong class="text-foreground">{formatDate(batch.activated_at)}</strong
							></span
						>
					</div>
				</div>

				<!-- Allocations and Physical Lots -->
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h4 class="font-semibold text-foreground">รายการสิ่งของและ Physical Lot ที่จัดสรร</h4>
						<span class="text-[11px] text-muted-foreground">
							{batch.allocations.length} รายการจัดสรร
						</span>
					</div>

					<div
						class="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/80 bg-white dark:bg-slate-950"
					>
						{#each batch.allocations as allocation, index (allocation.lot_ref + '-' + index)}
							{@const itemMaster = itemMastersMap.get(allocation.item_id)}
							{@const requestItem = batch.items.find((it) => it.item_id === allocation.item_id)}
							<div class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
								<div class="space-y-0.5">
									<div class="flex items-center gap-1.5 font-medium text-foreground">
										<Package class="size-3.5 text-muted-foreground" />
										<span>{itemMaster?.name ?? allocation.item_id}</span>
									</div>
									<div
										class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground"
									>
										<span
											>Lot Ref: <code class="font-mono text-[10px] text-foreground"
												>{shortLotRef(allocation.lot_ref)}</code
											></span
										>
										{#if allocation.lot.lot_no}
											<span
												>• Lot No: <strong class="text-foreground">{allocation.lot.lot_no}</strong
												></span
											>
										{/if}
										{#if allocation.lot.storage_zone}
											<span
												>• โซน: <strong class="text-foreground"
													>{allocation.lot.storage_zone}</strong
												></span
											>
										{/if}
										{#if allocation.lot.expiry}
											<span>• หมดอายุ: {formatDate(allocation.lot.expiry)}</span>
										{/if}
									</div>
								</div>

								<div class="flex items-baseline gap-1 self-end sm:self-auto">
									<span class="text-sm font-bold text-emerald-700 dark:text-emerald-400">
										{allocation.qty}
									</span>
									<span class="text-[11px] text-muted-foreground">
										{requestItem?.unit ?? itemMaster?.base_unit ?? 'หน่วย'}
									</span>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
