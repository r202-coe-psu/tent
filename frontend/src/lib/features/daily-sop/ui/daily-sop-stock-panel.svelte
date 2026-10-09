<script lang="ts">
	import { RefreshCw, Search, TriangleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { formatUnit } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { formatStockQuantity, isNonPositiveStockQuantity } from '../domain/daily-sop.stock';

	type StockItem = { item_id: string; name: string; unit: string; qty_on_hand: string };

	interface Props {
		open: boolean;
		shelterCode: string;
		status: 'loading' | 'error' | 'ready';
		refreshFailed: boolean;
		items: readonly StockItem[];
		updatedLabel: string | null;
		isRefreshing: boolean;
		onRefresh: () => void;
		onReturnFocus: () => void;
	}

	let {
		open = $bindable(),
		shelterCode,
		status,
		refreshFailed,
		items,
		updatedLabel,
		isRefreshing,
		onRefresh,
		onReturnFocus
	}: Props = $props();

	let search = $state('');
	const filtered = $derived.by(() => {
		const term = search.trim().toLocaleLowerCase('th');
		return term
			? items.filter(
					(item) =>
						item.name.toLocaleLowerCase('th').includes(term) ||
						item.item_id.toLocaleLowerCase('th').includes(term)
				)
			: items;
	});
</script>

<Sheet.Root
	bind:open
	onOpenChange={(nextOpen) => {
		if (!nextOpen) search = '';
	}}
>
	<Sheet.Content
		side="bottom"
		class="flex max-h-[72dvh] flex-col gap-0 overflow-hidden rounded-t-2xl border-slate-200 bg-white p-0 [&>button:last-child]:flex [&>button:last-child]:size-12 [&>button:last-child]:items-center [&>button:last-child]:justify-center"
		data-testid="daily-sop-stock-sheet"
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			onReturnFocus();
		}}
	>
		<Sheet.Header class="relative shrink-0 space-y-3 border-b border-slate-200/80 p-4 sm:p-5">
			<div class="flex min-w-0 items-start justify-between gap-2 pr-12">
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					<Sheet.Title class="text-lg font-bold text-slate-900">ยอดคงเหลือในระบบ</Sheet.Title>
					<span
						class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
						>อ่านอย่างเดียว</span
					>
				</div>
			</div>
			<div class="flex items-center justify-between gap-3">
				<Sheet.Description class="text-sm text-slate-500">
					ศูนย์ {shelterCode} · {#if updatedLabel}อัปเดต {updatedLabel}{:else if status === 'ready'}ยังไม่มีเวลา
						ledger บันทึก{:else if status === 'error'}โหลดไม่สำเร็จ{:else}กำลังโหลดข้อมูล{/if}
				</Sheet.Description>
				<Button
					variant="ghost"
					size="icon"
					class="size-12 shrink-0 sm:size-11"
					disabled={isRefreshing}
					onclick={onRefresh}
				>
					<RefreshCw class={isRefreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
					<span class="sr-only">รีเฟรชยอดคงเหลือ</span>
				</Button>
			</div>
			{#if status === 'ready' && items.length >= 8}
				<div class="relative">
					<Search class="absolute top-3 left-3 size-4 text-slate-400" aria-hidden="true" />
					<Input
						type="search"
						aria-label="ค้นหาชื่อหรือรหัสสินค้า"
						placeholder="ค้นหาชื่อหรือรหัสสินค้า"
						bind:value={search}
						class="h-12 pl-9 text-base sm:h-11"
					/>
				</div>
			{/if}
			{#if refreshFailed}
				<div
					class="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
					role="status"
				>
					<p class="min-w-0 text-sm text-amber-950">
						รีเฟรชไม่สำเร็จ แสดงข้อมูลเมื่อ {updatedLabel ?? 'ไม่ทราบเวลา'}
					</p>
					<Button
						variant="outline"
						class="min-h-11 shrink-0 px-3"
						disabled={isRefreshing}
						onclick={onRefresh}>ลองใหม่</Button
					>
				</div>
			{/if}
		</Sheet.Header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if status === 'loading'}
				<div class="space-y-3 p-4 sm:p-5" role="status" aria-label="กำลังโหลดรายการคลัง">
					{#each [1, 2, 3, 4, 5] as row (row)}
						<Skeleton class="h-12 w-full rounded-lg" />
					{/each}
				</div>
			{:else if status === 'error'}
				<div class="m-4 space-y-3 rounded-xl border border-red-200 bg-white p-4" role="alert">
					<p class="flex items-start gap-2 text-sm font-medium text-red-900">
						<TriangleAlert class="mt-0.5 size-4 shrink-0 text-red-600" />โหลดรายการคลังไม่สำเร็จ
					</p>
					<p class="text-sm text-slate-600">เลือก “รอตรวจ” และระบุสาเหตุในหมายเหตุได้</p>
					<Button variant="outline" class="min-h-12" onclick={onRefresh}>ลองโหลดใหม่</Button>
				</div>
			{:else if items.length === 0}
				<p class="p-4 text-sm text-slate-600 sm:p-5">
					ไม่มีรายการในระบบ หากยืนยันยอดศูนย์ทั้งบัญชีและของจริงแล้วจึงเลือกผ่าน
				</p>
			{:else if filtered.length === 0}
				<p class="p-4 text-sm text-slate-600 sm:p-5">ไม่พบรายการที่ค้นหา</p>
			{:else}
				<ul class="divide-y divide-slate-200/80">
					{#each filtered as item (item.item_id)}
						<li class="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-5">
							<span class="min-w-0">
								<span class="block text-base font-medium text-slate-900">{item.name}</span>
							</span>
							<span class="shrink-0 text-right tabular-nums">
								<strong
									class={`text-base font-bold ${isNonPositiveStockQuantity(item.qty_on_hand) ? 'text-rose-800' : 'text-slate-900'}`}
									>{formatStockQuantity(item.qty_on_hand)}</strong
								>
								<span class="ml-1 text-sm text-slate-500"
									>{formatUnit(item.unit, undefined, langState.current)}</span
								>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<Sheet.Footer
			class="shrink-0 flex-col items-stretch gap-2 border-t border-slate-200/80 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
		>
			<p class="text-sm text-slate-600">
				{#if status === 'ready'}
					<span class="font-semibold tabular-nums">{filtered.length}</span> จาก
					<span class="tabular-nums">{items.length}</span> รายการ
				{/if}
				<span class="block text-xs">นับจริงด้วยหน่วยเดียวกัน · ส่วนต่างระบุในหมายเหตุ</span>
			</p>
			<Sheet.Close>
				{#snippet child({ props })}
					<Button variant="outline" class="min-h-12 w-full sm:min-h-11 sm:w-auto" {...props}
						>ปิด</Button
					>
				{/snippet}
			</Sheet.Close>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
