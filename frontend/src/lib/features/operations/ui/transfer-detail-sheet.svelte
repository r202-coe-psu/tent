<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { transferItemLabel } from '../domain/transfer-item-label';
	import { transferTimelineSteps } from '../domain/transfer-timeline';
	import type { StockTransfer } from '../domain/operations';
	import { STATUS_LABEL, statusBadgeClass } from './transfer-status';

	let {
		open = $bindable(false),
		transfer,
		ownShelter,
		namesById,
		formatUnitLabel = (u: string) => u
	}: {
		open?: boolean;
		transfer: StockTransfer | null;
		ownShelter: string;
		namesById: ReadonlyMap<string, string>;
		formatUnitLabel?: (unit: string) => string;
	} = $props();

	const steps = $derived(transfer ? transferTimelineSteps(transfer) : []);
	const reasons = $derived(
		transfer
			? [
					{ label: 'เหตุผลที่คัดค้าน/ระงับ', value: transfer.dispute_reason },
					{ label: 'เหตุผลที่ยกเลิก', value: transfer.cancel_reason },
					{ label: 'หมายเหตุ', value: transfer.notes }
				].filter((r) => r.value)
			: []
	);
	const hasShipping = $derived(!!transfer && !!(transfer.driver_name || transfer.vehicle_plate));

	function lineOf(item: StockTransfer['items'][number]) {
		return transferItemLabel(item, namesById, formatUnitLabel);
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
		{#if transfer}
			<Sheet.Header class="space-y-2 border-b border-border/60 p-4 pr-12 text-left">
				<Sheet.Title class="font-mono text-base font-bold">
					{transfer.from_shelter} → {transfer.to_shelter}
				</Sheet.Title>
				<Sheet.Description class="sr-only">รายละเอียดการโอนย้ายสินค้า</Sheet.Description>
				<div class="flex flex-wrap items-center gap-2">
					<span
						class="inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold {statusBadgeClass(
							transfer.status
						)}"
					>
						{STATUS_LABEL[transfer.status]}
					</span>
					<span
						class="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground"
					>
						{transfer.from_shelter === ownShelter ? 'ต้นทาง (เรา)' : 'ปลายทาง (เรา)'}
					</span>
				</div>
				<p class="font-mono text-[11px] break-all text-muted-foreground">{transfer._id}</p>
			</Sheet.Header>

			<div class="space-y-5 p-4">
				<section>
					<h4 class="mb-2 text-sm font-bold text-foreground">รายการสินค้า</h4>
					<ul class="space-y-2">
						{#each transfer.items as item (item.item_id)}
							{@const line = lineOf(item)}
							{@const received = item.received_qty !== undefined}
							<li class="rounded-lg border border-border/60 p-2.5 text-sm">
								<p class="font-semibold">{line.name}</p>
								<p class="text-xs text-muted-foreground">{item.qty} {line.unit}</p>
								{#if received}
									<p
										class="mt-0.5 text-xs {Number(item.received_qty) !== Number(item.qty)
											? 'font-bold text-rose-700'
											: 'text-emerald-700'}"
									>
										รับจริง {item.received_qty}
										{line.unit}
									</p>
								{/if}
							</li>
						{/each}
					</ul>
				</section>

				{#if hasShipping}
					<section>
						<h4 class="mb-2 text-sm font-bold text-foreground">การขนส่ง</h4>
						<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
							{#if transfer.driver_name}
								<dt class="text-muted-foreground">คนขับ</dt>
								<dd>{transfer.driver_name}</dd>
							{/if}
							{#if transfer.vehicle_plate}
								<dt class="text-muted-foreground">ทะเบียนรถ</dt>
								<dd>{transfer.vehicle_plate}</dd>
							{/if}
						</dl>
					</section>
				{/if}

				<section>
					<h4 class="mb-2 text-sm font-bold text-foreground">ไทม์ไลน์</h4>
					<ol class="space-y-3 border-l border-border pl-4">
						{#each steps as step (step.key)}
							<li class="relative text-sm">
								<span
									class="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-primary"
									aria-hidden="true"
								></span>
								<p class="font-semibold">{step.label}</p>
								<p class="text-xs text-muted-foreground">
									{formatThaiDateTime(step.at)}{step.by ? ` · โดย ${step.by}` : ''}
								</p>
							</li>
						{/each}
					</ol>
				</section>

				{#if reasons.length > 0}
					<section>
						<h4 class="mb-2 text-sm font-bold text-foreground">เหตุผล / หมายเหตุ</h4>
						<dl class="space-y-2 text-sm">
							{#each reasons as r (r.label)}
								<div>
									<dt class="text-xs text-muted-foreground">{r.label}</dt>
									<dd class="whitespace-pre-wrap">{r.value}</dd>
								</div>
							{/each}
						</dl>
					</section>
				{/if}
			</div>
		{:else}
			<Sheet.Header class="sr-only">
				<Sheet.Title>รายละเอียดการโอน</Sheet.Title>
				<Sheet.Description>ไม่พบรายการโอนที่เลือก</Sheet.Description>
			</Sheet.Header>
		{/if}
	</Sheet.Content>
</Sheet.Root>
