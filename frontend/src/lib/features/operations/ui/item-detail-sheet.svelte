<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ItemPolicyPanel } from '$lib/features/sop-ratios/item-policy';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Boxes from '@lucide/svelte/icons/boxes';
	import type { LotPriorityItem } from '../domain/lot-priority';
	import type { StockLotBalance } from '../domain/operations';
	import { useStoragePoints } from '../application/use-storage-points.svelte';
	import LedgerTable from './ledger-table.svelte';
	import { buildLotRows } from './stock/lot-view';
	import type { StockDisplayRow } from './stock/stock-view';

	export type ItemDetailAction = 'receive' | 'distribute' | 'adjust';

	let {
		open = $bindable(false),
		row,
		lots,
		itemsById,
		shelterCode,
		offline = false,
		onaction
	}: {
		open?: boolean;
		row: StockDisplayRow | undefined;
		/** Every lot of this item (zero-qty lots are dropped here). */
		lots: readonly StockLotBalance[];
		/** Shelf life / storage type per item — feeds the lot order and its reason. */
		itemsById?: ReadonlyMap<string, LotPriorityItem>;
		shelterCode: string;
		/** Session expired: reading stays available, the movement buttons are off. */
		offline?: boolean;
		onaction: (kind: ItemDetailAction) => void;
	} = $props();

	const storagePoints = useStoragePoints(() => shelterCode);
	const lotRows = $derived(buildLotRows(lots, storagePoints.points, Date.now(), itemsById));

	const ACTIONS = [
		{ kind: 'receive', label: 'รับเข้า', icon: ArrowDownToLine },
		{ kind: 'distribute', label: 'เบิกจ่าย', icon: ArrowUpFromLine },
		{ kind: 'adjust', label: 'ปรับยอด', icon: SlidersHorizontal }
	] as const;
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="right"
		class="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-0 p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-none md:w-[36rem] md:border-l"
	>
		{#if row}
			<Sheet.Header class="shrink-0 space-y-3 border-b border-slate-200/80 p-4 pr-12 text-left">
				<Sheet.Title class="flex items-center gap-2 text-xl font-bold text-slate-900">
					<Boxes class="h-5 w-5 shrink-0 text-teal-700" aria-hidden="true" />
					{row.name}
				</Sheet.Title>
				<Sheet.Description class="sr-only">
					ล็อต ประวัติการเคลื่อนไหว และตั้งค่าเกณฑ์ของ {row.name}
				</Sheet.Description>

				<dl class="grid grid-cols-3 gap-2">
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
						<dt class="text-xs text-slate-500">คงเหลือ</dt>
						<dd class="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
							{row.qtyOnHand}
							<span class="text-xs font-normal text-slate-500">{row.unitLabel}</span>
						</dd>
					</div>
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
						<dt class="text-xs text-slate-500">เกณฑ์</dt>
						<dd class="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
							{#if row.reorderThreshold !== null}
								{row.reorderThreshold}
								<span class="text-xs font-normal text-slate-500">{row.unitLabel}</span>
							{:else}
								<span class="text-slate-400">—</span>
							{/if}
						</dd>
					</div>
					<div class="rounded-xl border border-slate-200/80 bg-slate-50 p-2.5">
						<dt class="text-xs text-slate-500">พอใช้</dt>
						<dd class="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
							{#if row.coverDays !== null}
								~{row.coverDays} <span class="text-xs font-normal text-slate-500">วัน</span>
							{:else}
								<span class="text-slate-400">—</span>
							{/if}
						</dd>
					</div>
				</dl>

				<div class="grid grid-cols-3 gap-2">
					{#each ACTIONS as action (action.kind)}
						<Button
							type="button"
							variant={action.kind === 'receive' ? 'default' : 'outline'}
							aria-label="{action.label} {row.name}"
							class="min-h-11 gap-1.5 rounded-lg px-2 text-sm font-semibold {action.kind ===
							'receive'
								? 'bg-[#0A2647] text-white hover:bg-[#051930]'
								: 'border-slate-300 bg-white text-slate-800 shadow-2xs'}"
							disabled={offline}
							title={offline ? 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่เพื่อบันทึก' : undefined}
							onclick={() => onaction(action.kind)}
						>
							<action.icon class="h-4 w-4" aria-hidden="true" />
							{action.label}
						</Button>
					{/each}
				</div>
			</Sheet.Header>

			{#key row._id}
				<Tabs.Root value="lots" class="flex min-h-0 flex-1 flex-col gap-0">
					<Tabs.List class="mx-4 mt-3 h-11 w-auto shrink-0 self-stretch">
						<Tabs.Trigger value="lots" class="min-h-9">ล็อต</Tabs.Trigger>
						<Tabs.Trigger value="history" class="min-h-9">ประวัติ</Tabs.Trigger>
						<Tabs.Trigger value="settings" class="min-h-9">ตั้งค่าเกณฑ์</Tabs.Trigger>
					</Tabs.List>

					<div class="min-h-0 flex-1 overflow-y-auto p-4">
						<Tabs.Content value="lots">
							{#if lotRows.length === 0}
								<p class="py-10 text-center text-sm font-medium text-slate-500">ไม่มีล็อตคงเหลือ</p>
							{:else}
								<ul class="space-y-2.5">
									{#each lotRows as lot, index (lot.lotRef)}
										<li
											class="rounded-xl border p-3 {lot.isExpired
												? 'border-red-200 bg-red-50/40'
												: 'border-slate-200/80 bg-white'}"
										>
											<div class="flex flex-wrap items-center justify-between gap-2">
												<p class="flex items-baseline gap-1.5">
													<span class="text-lg font-bold text-slate-900 tabular-nums"
														>{lot.qty}</span
													>
													<span class="text-sm text-slate-500">{lot.unit}</span>
												</p>
												{#if lot.isNext}
													<span
														class="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-900 ring-1 ring-teal-200"
													>
														เบิกถัดไป
													</span>
												{:else if lot.isExpired}
													<span
														class="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800 ring-1 ring-red-200"
													>
														หมดอายุ — ปรับยอดออก
													</span>
												{/if}
											</div>
											<p class="mt-1.5 text-sm text-slate-700">
												{#if lot.expiry}หมดอายุ <span class="tabular-nums">{lot.expiry}</span
													>{:else}
													<span class="text-slate-500">ไม่ระบุวันหมดอายุ</span>
												{/if}
												{#if lot.storageName}
													<span class="text-slate-400" aria-hidden="true">·</span>
													{lot.storageName}
												{/if}
											</p>
											{#if lot.clockLine}
												<p class="mt-0.5 text-xs text-slate-500">{lot.clockLine}</p>
											{/if}
											<p
												class="mt-1 text-xs font-medium {lot.isExpired
													? 'text-red-800'
													: 'text-teal-900'}"
											>
												{lot.isExpired ? '' : `ลำดับที่ ${index + 1}: `}{lot.reason}
											</p>
										</li>
									{/each}
								</ul>
							{/if}
						</Tabs.Content>

						<Tabs.Content value="history">
							<LedgerTable filterItemId={row._id} />
						</Tabs.Content>

						<Tabs.Content value="settings">
							<ItemPolicyPanel itemId={row._id} itemName={row.name} {shelterCode} />
						</Tabs.Content>
					</div>
				</Tabs.Root>
			{/key}
		{:else}
			<Sheet.Title class="sr-only">รายละเอียดสินค้า</Sheet.Title>
			<Sheet.Description class="sr-only">ไม่พบสินค้าที่เลือก</Sheet.Description>
		{/if}
	</Sheet.Content>
</Sheet.Root>
