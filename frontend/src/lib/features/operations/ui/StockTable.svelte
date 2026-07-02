<script lang="ts">
	import { useStockBalance, useLedger } from '../application/queries';
	import { useSupplyItems } from '$lib/features/supply';
	import { SUPPLY_CATEGORY_LABELS, type SupplyCategory } from '$lib/features/supply';
	import * as Table from '$lib/components/ui/table/index.js';
	import Search from '@lucide/svelte/icons/search';
	import Filter from '@lucide/svelte/icons/filter';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Activity from '@lucide/svelte/icons/activity';
	import Boxes from '@lucide/svelte/icons/boxes';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Clock from '@lucide/svelte/icons/clock';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import History from '@lucide/svelte/icons/history';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Calendar from '@lucide/svelte/icons/calendar';
	import FileText from '@lucide/svelte/icons/file-text';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import * as Dialog from '$lib/components/ui/dialog';
	import LedgerTable from './LedgerTable.svelte';
	import ReceiveStockForm from './ReceiveStockForm.svelte';

	// ─── Queries ──────────────────────────────────────────────────────────────
	const itemsQuery = useSupplyItems();
	const balanceQuery = useStockBalance();
	const ledgerQuery = useLedger();

	// ─── Filter state ─────────────────────────────────────────────────────────
	let searchQuery = $state('');
	let categoryFilter = $state<SupplyCategory | 'all'>('all');
	let locationFilter = $state<string | 'all'>('all');
	let statusFilter = $state<'all' | 'normal' | 'low' | 'empty' | 'expiring' | 'expired'>('all');

	// ─── Modal state ──────────────────────────────────────────────────────────
	let selectedItemId = $state<string | null>(null);
	let isManageModalOpen = $state(false);
	let activeModalTab = $state<'history' | 'checkin'>('history');

	// ─── Derived data ─────────────────────────────────────────────────────────
	const items = $derived(itemsQuery.data ?? []);
	const balance = $derived(balanceQuery.data ?? new Map<string, number>());
	const ledger = $derived(ledgerQuery.data ?? []);

	/**
	 * Unique locations list extracted from ledger entries
	 */
	const uniqueLocations = $derived.by(() => {
		const locations = new Set<string>();
		for (const entry of ledger) {
			if (entry.lot?.note) {
				locations.add(entry.lot.note.trim());
			}
		}
		return Array.from(locations).filter(Boolean);
	});

	/**
	 * For each item, derive the latest lot info (expiry + storage note) from
	 * the most-recent POSITIVE ledger entry so the table can show them.
	 *
	 * LIMITATION: This picks the last inbound entry's lot per item_id. After a
	 * full distribute-then-restock cycle the table may briefly show the OLD lot's
	 * expiry/location until the new receive entry lands. A proper fix requires
	 * per-lot balance tracking (FIFO/FEFO), which is out of scope for T-11.
	 */
	const latestLotByItem = $derived.by(() => {
		const result: Record<string, { expiry?: string; note?: string }> = {};
		const sorted = [...ledger].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
		for (const entry of sorted) {
			if (entry.qty > 0 && (entry.lot?.expiry || entry.lot?.note)) {
				result[entry.item_id] = {
					expiry: entry.lot?.expiry,
					note: entry.lot?.note
				};
			}
		}
		return result;
	});

	/** Determine stock status based on qty vs reorder_level. */
	function getStatus(qty: number, reorderLevel: number | null): 'empty' | 'low' | 'normal' {
		if (qty <= 0) return 'empty';
		if (reorderLevel !== null && qty <= reorderLevel) return 'low';
		return 'normal';
	}

	/** Check if an expiry date string is within the next `days` days. */
	function isExpiringSoon(expiryStr: string | undefined, days = 7): boolean {
		if (!expiryStr) return false;
		const exp = Date.parse(expiryStr);
		if (Number.isNaN(exp)) return false;
		return exp - Date.now() <= days * 86_400_000 && exp > Date.now();
	}

	function isExpired(expiryStr: string | undefined): boolean {
		if (!expiryStr) return false;
		const exp = Date.parse(expiryStr);
		return !Number.isNaN(exp) && exp <= Date.now();
	}

	/** Filtered and searched items list. */
	const displayedItems = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		return items.filter((item) => {
			// Search
			if (q && !item.name.toLowerCase().includes(q) && !item._id.toLowerCase().includes(q)) return false;
			// Category
			if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
			
			const qty = balance.get(item._id) ?? 0;
			const status = getStatus(qty, item.reorder_level);
			const lot = latestLotByItem[item._id];
			const expired = isExpired(lot?.expiry);
			const expiring = isExpiringSoon(lot?.expiry);

			// Location Filter
			if (locationFilter !== 'all') {
				if (!lot?.note || lot.note.trim() !== locationFilter) return false;
			}

			// Status Filter
			if (statusFilter !== 'all') {
				if (statusFilter === 'normal' && status !== 'normal') return false;
				if (statusFilter === 'low' && status !== 'low') return false;
				if (statusFilter === 'empty' && status !== 'empty') return false;
				if (statusFilter === 'expired' && !expired) return false;
				if (statusFilter === 'expiring' && !expiring) return false;
			}
			return true;
		});
	});

	const isLoading = $derived(
		itemsQuery.isLoading || balanceQuery.isLoading || ledgerQuery.isLoading
	);

	// ─── Helpers ──────────────────────────────────────────────────────────────
	const CATEGORY_OPTIONS = Object.entries(SUPPLY_CATEGORY_LABELS) as [SupplyCategory, string][];

	function formatExpiry(expiryStr: string | undefined): string {
		if (!expiryStr) return '-';
		try {
			return new Date(expiryStr).toLocaleDateString('th-TH', {
				day: '2-digit',
				month: 'short',
				year: '2-digit'
			});
		} catch {
			return expiryStr;
		}
	}

	const CATEGORY_STYLES: Record<SupplyCategory, string> = {
		food: 'bg-[#e8f0fe] text-[#0071e3] border-[#d2e3fc] dark:bg-[#0071e3]/10 dark:text-[#66b2ff] dark:border-[#0071e3]/20',
		water: 'bg-[#e6f4ea] text-[#137333] border-[#ceead6] dark:bg-[#137333]/10 dark:text-[#57bb8a] dark:border-[#137333]/20',
		medicine: 'bg-[#fce8e6] text-[#c5221f] border-[#fad2cf] dark:bg-[#c5221f]/10 dark:text-[#ff6b6b] dark:border-[#c5221f]/20',
		clothing: 'bg-[#f3e8fd] text-[#8430ce] border-[#e8d5f9] dark:bg-[#8430ce]/10 dark:text-[#c084fc] dark:border-[#8430ce]/20',
		hygiene: 'bg-[#e2f1f8] text-[#0288d1] border-[#b3e5fc] dark:bg-[#0288d1]/10 dark:text-[#38bdf8] dark:border-[#0288d1]/20',
		bedding: 'bg-[#f1f8e9] text-[#558b2f] border-[#dcedc8] dark:bg-[#558b2f]/10 dark:text-[#a3e635] dark:border-[#558b2f]/20',
		equipment: 'bg-[#f8f9fa] text-[#5f6368] border-[#dadce0] dark:bg-[#f8f9fa]/10 dark:text-[#9ca3af] dark:border-[#dadce0]/20',
		other: 'bg-[#f8f9fa] text-[#5f6368] border-[#dadce0] dark:bg-[#f8f9fa]/10 dark:text-[#9ca3af] dark:border-[#dadce0]/20'
	};
</script>

<div class="space-y-6">
	<!-- Main Stock Inventory Card -->
	<div class="bg-card/85 backdrop-blur-xl rounded-[24px] border border-border/80 p-6 shadow-md flex flex-col h-full min-h-[55vh] transition-all">
		<!-- Title Section -->
		<div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-border/60 pb-6">
			<div>
				<h2 class="text-2xl font-bold text-foreground flex items-center gap-2">
					<Boxes class="h-6 w-6 text-primary" />
					รายการสิ่งของในคลัง (Inventory)
				</h2>
				<p class="text-muted-foreground mt-2 text-sm max-w-2xl">
					แสดงผลรายการสินค้าและยอดคงเหลือในคลัง ประเมินความเพียงพอของสต๊อกอ้างอิงตามระดับเกณฑ์เตือนภัยเพื่อป้องกันของขาดแคลน
				</p>
			</div>
		</div>

		<!-- Filter Bar -->
		<div class="flex flex-col xl:flex-row gap-3 mb-6 bg-muted/30 p-4 rounded-xl border border-border/60">
			<!-- Search -->
			<div class="relative flex-1 min-w-[240px]">
				<Search class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
				<input
					type="text"
					placeholder="ค้นหารหัสข้อมูล (SKU), ชื่อรายการ..."
					bind:value={searchQuery}
					class="w-full bg-background border border-border/80 focus:border-primary transition-all rounded-lg pl-9 pr-4 py-2.5 text-sm outline-none shadow-sm"
				/>
			</div>
			
			<div class="flex flex-col sm:flex-row gap-3 flex-wrap">
				<!-- Category Dropdown -->
				<div class="relative w-full sm:w-48">
					<Filter class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground z-10 h-4 w-4" />
					<select
						bind:value={categoryFilter}
						class="w-full bg-background border border-border/80 focus:border-primary transition-all rounded-lg pl-9 pr-8 py-2.5 text-sm font-semibold text-foreground outline-none cursor-pointer shadow-sm appearance-none truncate"
					>
						<option value="all">ทุกหมวดหมู่ (Category)</option>
						{#each CATEGORY_OPTIONS as [val, label] (val)}
							<option value={val}>{label}</option>
						{/each}
					</select>
					<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground">
						<ChevronDown class="h-4 w-4" />
					</div>
				</div>

				<!-- Location Dropdown -->
				<div class="relative w-full sm:w-48">
					<MapPin class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground z-10 h-4 w-4" />
					<select
						bind:value={locationFilter}
						class="w-full bg-background border border-border/80 focus:border-primary transition-all rounded-lg pl-9 pr-8 py-2.5 text-sm font-semibold text-foreground outline-none cursor-pointer shadow-sm appearance-none truncate"
					>
						<option value="all">ทุกสถานที่จัดเก็บ</option>
						{#each uniqueLocations as loc (loc)}
							<option value={loc}>{loc}</option>
						{/each}
					</select>
					<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground">
						<ChevronDown class="h-4 w-4" />
					</div>
				</div>

				<!-- Status Dropdown -->
				<div class="relative w-full sm:w-[210px]">
					<Activity class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground z-10 h-4 w-4" />
					<select
						bind:value={statusFilter}
						class="w-full bg-background border border-border/80 focus:border-primary transition-all rounded-lg pl-9 pr-8 py-2.5 text-sm font-semibold text-foreground outline-none cursor-pointer shadow-sm appearance-none"
					>
						<option value="all">ทุกสถานะความเสี่ยง (Status)</option>
						<option value="normal">🟢 ปกติ (Healthy)</option>
						<option value="low">🟡 เฝ้าระวัง (Warning)</option>
						<option value="empty">🔴 วิกฤตสต๊อก (Critical)</option>
						<option value="expiring">⏳ เสี่ยงหมดอายุ (Expiring)</option>
						<option value="expired">❌ หมดอายุแล้ว (Expired)</option>
					</select>
					<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground">
						<ChevronDown class="h-4 w-4" />
					</div>
				</div>
			</div>
		</div>

		<!-- Table -->
		{#if isLoading}
			<div class="space-y-3 flex-1">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<div class="h-16 animate-pulse rounded-xl border border-border bg-muted/20"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="rounded-2xl border border-border/60 bg-muted/10 p-12 text-center flex-1 flex flex-col justify-center items-center">
				<Boxes class="mb-4 h-12 w-12 text-muted-foreground/40" />
				<h3 class="text-base font-semibold text-foreground">ยังไม่มีรายการพัสดุในระบบ</h3>
				<p class="mt-1 text-sm text-muted-foreground">
					กรุณาเพิ่มรายการพัสดุในระบบกลาง หรือเปิดการซิงค์ข้อมูล
				</p>
			</div>
		{:else}
			<div class="overflow-x-auto flex-1 rounded-2xl border border-border/60 shadow-sm bg-background">
				<table class="w-full text-left border-collapse text-xs whitespace-nowrap min-w-[900px]">
					<thead class="bg-muted/50 border-b border-border/60 sticky top-0 z-10">
						<tr class="font-bold text-foreground uppercase tracking-wider text-[11px]">
							<th class="p-4 px-5">รายการสินค้า (SKU)</th>
							<th class="p-4">หมวดหมู่</th>
							<th class="p-4 text-center">สถานที่จัดเก็บ</th>
							<th class="p-4 text-center">วันหมดอายุ</th>
							<th class="p-4 text-center">ยอดคงเหลือ</th>
							<th class="p-4 text-center">สถานะ</th>
							<th class="p-4 text-center px-5 w-[100px]">จัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/40">
						{#if displayedItems.length === 0}
							<tr>
								<td colspan={7} class="p-12 text-center text-muted-foreground font-medium text-sm">
									ไม่พบข้อมูลสิ่งของที่ตรงกับเงื่อนไขการค้นหา
								</td>
							</tr>
						{:else}
							{#each displayedItems as item (item._id)}
								{@const qty = balance.get(item._id) ?? 0}
								{@const status = getStatus(qty, item.reorder_level)}
								{@const lot = latestLotByItem[item._id]}
								{@const expired = isExpired(lot?.expiry)}
								{@const expiring = isExpiringSoon(lot?.expiry)}

								<tr
									class={[
										'transition-all duration-200 border-l-4 hover:bg-muted/40 hover:translate-x-0.5',
										expired ? 'border-l-rose-600 bg-rose-500/5' :
										status === 'empty' ? 'border-l-rose-500 bg-rose-500/5' :
										expiring ? 'border-l-orange-500 bg-orange-500/5' :
										status === 'low' ? 'border-l-amber-500 bg-amber-500/5' :
										'border-l-transparent'
									]}
								>
									<!-- Item name + ID -->
									<td class="p-4 px-5">
										<div class="flex flex-col gap-1">
											<span class="text-foreground font-semibold text-[14px]">
												{item.name}
											</span>
											<div class="flex items-center gap-2">
												<span class="text-[11px] text-muted-foreground font-mono">
													{item._id}
												</span>
												{#if item.perishable}
													<span class="text-[10px] font-bold text-orange-600 dark:text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded">
														เน่าเสียได้
													</span>
												{/if}
											</div>
										</div>
									</td>

									<!-- Category badge -->
									<td class="p-4">
										<span class="text-[10px] font-bold px-2.5 py-1 rounded-md border text-center whitespace-nowrap {CATEGORY_STYLES[item.category]}">
											{SUPPLY_CATEGORY_LABELS[item.category] || item.category}
										</span>
									</td>

									<!-- Storage location -->
									<td class="p-4 text-center">
										{#if lot?.note}
											<span class="text-[12px] text-foreground font-medium bg-muted/60 border border-border/80 px-2.5 py-1 rounded-lg">
												📍 {lot.note}
											</span>
										{:else}
											<span class="text-xs text-muted-foreground/40">-</span>
										{/if}
									</td>

									<!-- Expiry date -->
									<td class="p-4 text-center">
										{#if lot?.expiry}
											<span class="text-[12px] font-bold px-2 py-1 rounded-md {expired ? 'text-rose-600 bg-rose-500/10 border border-rose-500/20' : expiring ? 'text-orange-600 bg-orange-500/10 border border-orange-500/20' : 'text-foreground bg-muted/60 border border-border/80'}">
												{expired ? '❌ ' : expiring ? '⏳ ' : '📅 '}
												{formatExpiry(lot.expiry)}
											</span>
										{:else}
											<span class="text-xs text-muted-foreground/40">-</span>
										{/if}
									</td>

									<!-- Balance -->
									<td class="p-4 text-center font-mono font-bold text-sm">
										<div class="flex flex-col items-center gap-0.5">
											<span class="px-2.5 py-1 rounded-md {expired || status === 'empty' ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20' : status === 'low' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' : 'bg-muted/80 text-foreground border border-border/60'}">
												{qty.toLocaleString()} <span class="text-[11px] font-normal text-muted-foreground">{item.unit}</span>
											</span>
											{#if item.reorder_level !== null}
												<span class="text-[10px] font-normal text-muted-foreground/60">
													เกณฑ์: {item.reorder_level} {item.unit}
												</span>
											{/if}
										</div>
									</td>

									<!-- Status -->
									<td class="p-4 text-center">
										{#if expired}
											<span class="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-600">
												<XCircle class="h-3.5 w-3.5" /> หมดอายุแล้ว
											</span>
										{:else if status === 'empty'}
											<span class="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-600">
												<XCircle class="h-3.5 w-3.5" /> วิกฤตสต๊อก
											</span>
										{:else if status === 'low'}
											<span class="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600">
												<AlertTriangle class="h-3.5 w-3.5" /> เฝ้าระวัง
											</span>
										{:else}
											<span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600">
												<CheckCircle class="h-3.5 w-3.5" /> ปกติ
											</span>
										{/if}
									</td>

									<!-- Action -->
									<td class="p-4 text-center px-5">
										<button
											onclick={() => {
												selectedItemId = item._id;
												activeModalTab = 'history';
												isManageModalOpen = true;
											}}
											class="bg-background hover:bg-muted text-foreground border border-border/80 p-1.5 px-3 rounded-xl transition-all hover:scale-[1.05] active:scale-[0.95] duration-200 cursor-pointer flex items-center justify-center gap-1.5 text-[12px] font-bold shadow-sm"
										>
											<History class="h-3.5 w-3.5 text-muted-foreground" /> จัดการ
										</button>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Footer summary row -->
			{#if !isLoading && items.length > 0}
				{@const emptyCount = items.filter((i) => (balance.get(i._id) ?? 0) <= 0).length}
				{@const lowCount = items.filter((i) => {
					const qty = balance.get(i._id) ?? 0;
					return qty > 0 && i.reorder_level !== null && qty <= i.reorder_level;
				}).length}
				<div class="flex items-center justify-between border border-border/60 bg-muted/20 px-4 py-3 rounded-2xl text-xs text-muted-foreground shadow-sm">
					<span>แสดง {displayedItems.length} จาก {items.length} รายการ</span>
					<div class="flex gap-3">
						{#if emptyCount > 0}
							<span class="font-bold text-rose-600">🔴 หมดแล้ว: {emptyCount} รายการ</span>
						{/if}
						{#if lowCount > 0}
							<span class="font-bold text-amber-600">🟡 ใกล้หมด: {lowCount} รายการ</span>
						{/if}
						{#if emptyCount === 0 && lowCount === 0}
							<span class="font-medium text-emerald-600">🟢 สต็อกปกติทั้งหมด</span>
						{/if}
					</div>
				</div>
			{/if}
		{/if}

		<!-- Timing note -->
		{#if !isLoading}
			<p class="text-right text-[10px] text-muted-foreground/50 mt-3">
				<Clock class="mr-0.5 inline h-3 w-3" />
				ข้อมูลอัปเดตอัตโนมัติผ่าน PouchDB live changes feed
			</p>
		{/if}
	</div>
</div>

<!-- Manage / History Modal (Dialog) -->
<Dialog.Root bind:open={isManageModalOpen}>
	<Dialog.Content class="max-h-[90vh] max-w-4xl sm:max-w-4xl overflow-y-auto rounded-[24px] border border-border bg-card shadow-2xl p-6">
		<Dialog.Header class="border-b border-border/60 pb-4 mb-4">
			{#if selectedItemId}
				{@const item = items.find((i) => i._id === selectedItemId)}
				<Dialog.Title class="text-xl font-bold text-foreground flex items-center gap-2">
					<Boxes class="h-5 w-5 text-primary" />
					จัดการสต็อก: {item?.name ?? ''}
				</Dialog.Title>
				<Dialog.Description class="text-sm text-muted-foreground font-mono mt-1">
					ID: {selectedItemId} | หน่วยนับ: {item?.unit ?? ''}
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		<!-- Tabs Inside Modal -->
		<div class="flex border-b border-border/60 mb-5">
			<button 
				onclick={() => activeModalTab = 'history'} 
				class="px-4 py-2.5 border-b-2 font-bold text-sm transition-all flex items-center gap-2 cursor-pointer {activeModalTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<Clock class="h-4 w-4" /> ประวัติความเคลื่อนไหว (Ledger)
			</button>
			<button 
				onclick={() => activeModalTab = 'checkin'} 
				class="px-4 py-2.5 border-b-2 font-bold text-sm transition-all flex items-center gap-2 cursor-pointer {activeModalTab === 'checkin' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			>
				<PlusCircle class="h-4 w-4" /> ทำรายการรับของเข้า (Check-in)
			</button>
		</div>

		<div class="mt-2">
			{#if selectedItemId}
				{#if activeModalTab === 'history'}
					<LedgerTable filterItemId={selectedItemId} />
				{:else if activeModalTab === 'checkin'}
					<ReceiveStockForm 
						preselectedItemId={selectedItemId} 
						onsuccess={() => {
							isManageModalOpen = false;
						}}
					/>
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
