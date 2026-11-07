<script lang="ts">
	import { useLedgerByItem, useLedgerRefLabels } from '../../application/queries';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import * as Table from '$lib/components/ui/table/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import { qtyGt } from '$lib/utils/qty';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { resolve } from '$app/paths';
	import { ADJUST_REASON_LABELS, ledgerEntryLabel, ledgerRefHref, toTime } from './ledger-view';
	import { resolveAdjustReason } from '../../domain/operations';
	import { shortLedgerRef } from '../../domain/ledger-ref';
	import { lotStorageName } from '../../domain/lot-storage';
	import { useStoragePoints } from '../../application/use-storage-points.svelte';

	/** One item's movement history, for the item detail sheet. The shelter-wide view is `ledger-movements.svelte`. */
	let { filterItemId }: { filterItemId: string } = $props();

	// Fetch stock movements ledger
	const storagePoints = useStoragePoints(() => getShelterCode());
	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);
	const ledgerQuery = useLedgerByItem(() => filterItemId);

	const ledger = $derived(ledgerQuery.data ?? []);
	// Sort by occurred_at descending to show newest entries first
	const sortedLedger = $derived(
		[...ledger].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
	);

	// A `ref_id` read as words (ใบบริจาค · …YAKTK), the same labels the movements tab prints.
	const refLabelsQuery = useLedgerRefLabels(() =>
		ledger.flatMap((entry) => (entry.ref_id ? [entry.ref_id] : []))
	);
	const refLabel = (refId: string) => refLabelsQuery.data?.get(refId) ?? shortLedgerRef(refId);

	const HEAD_CLASS =
		'px-1.5 text-2xs font-bold tracking-wider whitespace-nowrap text-foreground uppercase';
</script>

<div class="space-y-4">
	{#if ledgerQuery.isLoading}
		<div class="space-y-2">
			{#each [0, 1, 2] as i (i)}
				<div class="h-12 animate-pulse rounded-xl border border-border bg-muted/20"></div>
			{/each}
		</div>
	{:else if ledgerQuery.isError}
		<p class="text-sm font-semibold text-destructive">
			เกิดข้อผิดพลาด: {ledgerQuery.error?.message}
		</p>
	{:else if sortedLedger.length === 0}
		<div
			class="flex flex-col items-center justify-center rounded-2xl border border-border bg-muted/10 p-10 text-center"
		>
			<Clock class="mb-3 h-10 w-10 text-muted-foreground/30" />
			<p class="text-sm font-medium text-muted-foreground">ยังไม่มีรายการเคลื่อนไหวคลังในระบบ</p>
			<p class="mt-1 text-xs text-muted-foreground/60">
				ทำรายการ "รับของเข้าคลัง" เพื่อสร้างความเคลื่อนไหวแรก
			</p>
		</div>
	{:else}
		<div class="overflow-hidden rounded-2xl border border-border/80 bg-background shadow-sm">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header class="border-b border-border/60 bg-muted/40">
						<Table.Row class="hover:bg-transparent">
							<Table.Head class={HEAD_CLASS}>วัน-เวลา / ผู้บันทึก</Table.Head>
							<Table.Head class={HEAD_CLASS}>จำนวน</Table.Head>
							<Table.Head class={HEAD_CLASS}>ประเภท</Table.Head>
							<Table.Head class={HEAD_CLASS}>ล็อต / หมดอายุ</Table.Head>
							<Table.Head class={HEAD_CLASS}>ที่เก็บ</Table.Head>
							<Table.Head class={HEAD_CLASS}>อ้างอิง / หมายเหตุ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body class="divide-y divide-border/40">
						{#each sortedLedger as entry (entry._id)}
							{@const incoming = qtyGt(entry.qty, 0)}
							{@const adjustReason = resolveAdjustReason(entry)}
							{@const refHref = ledgerRefHref(entry.reason, entry.ref_id)}
							<!-- An outbound row keeps its destination in `lot.note`, not a storage place. -->
							{@const isOut = entry.reason === 'distribute' || entry.reason === 'requisition'}
							{@const destination = isOut ? (entry.lot?.note?.trim() ?? '') : ''}
							{@const place = lotStorageName(
								entry.lot && isOut ? { ...entry.lot, note: undefined } : entry.lot,
								storagePoints.points
							)}
							<Table.Row class="align-top transition-colors hover:bg-muted/30">
								<!-- Date, time and author -->
								<Table.Cell class="px-1.5 text-xs whitespace-nowrap">
									<span class="block font-medium text-foreground">
										{formatThaiShortDate(entry.occurred_at)}
										<span class="font-mono text-muted-foreground"
											>{toTime(new Date(entry.occurred_at))}</span
										>
									</span>
									<span class="block text-2xs text-muted-foreground">{entry.created_by}</span>
								</Table.Cell>

								<!-- Quantity, signed; the unit sits under the number to save width -->
								<Table.Cell class="px-1.5 text-xs whitespace-nowrap">
									<span
										class="inline-block rounded px-1.5 py-0.5 font-extrabold {incoming
											? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
											: 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}"
									>
										{incoming ? '+' : ''}{entry.qty}
									</span>
									<span class="mt-0.5 block text-2xs font-medium text-muted-foreground"
										>{formatUnit(entry.unit, units, langState.current)}</span
									>
								</Table.Cell>

								<!-- Type; rows from before schema_v 6 read as "other" (CR-143 FR-C4/C5) -->
								<Table.Cell class="px-1.5 whitespace-nowrap">
									<span
										class="rounded-full border px-2.5 py-0.5 text-2xs font-bold {incoming
											? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
											: 'border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'}"
									>
										{ledgerEntryLabel(entry)}
									</span>
									{#if adjustReason}
										<span class="mt-1 block text-2xs font-semibold text-foreground/80">
											{ADJUST_REASON_LABELS[adjustReason]}
										</span>
									{/if}
								</Table.Cell>

								<!-- Lot and its expiry; the produced date is the hover detail -->
								<Table.Cell
									class="px-1.5 text-xs whitespace-nowrap"
									title={entry.lot?.produced_at
										? `ผลิต ${formatThaiShortDate(entry.lot.produced_at)}`
										: undefined}
								>
									<span class="block font-mono text-foreground">{entry.lot?.lot_no ?? '—'}</span>
									{#if entry.lot?.expiry}
										<span class="block text-2xs text-muted-foreground">
											หมดอายุ {formatThaiShortDate(entry.lot.expiry)}
										</span>
									{/if}
								</Table.Cell>

								<!-- Storage place -->
								<Table.Cell class="px-1.5 text-xs whitespace-nowrap text-foreground">
									{place ?? '—'}
								</Table.Cell>

								<!-- Reference / note -->
								<Table.Cell
									class="max-w-44 min-w-24 px-1.5 text-xs whitespace-normal text-muted-foreground"
								>
									{#if entry.ref_id}
										{#if refHref}
											<a
												href={resolve(refHref)}
												title={entry.ref_id}
												class="font-medium whitespace-nowrap text-foreground underline underline-offset-2"
												>{refLabel(entry.ref_id)}</a
											>
										{:else}
											<span
												title={entry.ref_id}
												class="font-medium whitespace-nowrap text-foreground"
												>{refLabel(entry.ref_id)}</span
											>
										{/if}
									{/if}
									{#if destination}
										<span class="block [overflow-wrap:anywhere] text-foreground/80"
											>ไปที่ {destination}</span
										>
									{/if}
									{#if entry.note}
										<span class="block [overflow-wrap:anywhere] text-foreground/80"
											>{entry.note}</span
										>
									{/if}
									{#if !entry.ref_id && !entry.note && !destination}
										<span class="text-muted-foreground/60">—</span>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</div>
