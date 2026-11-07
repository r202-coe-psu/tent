<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import {
		useItemMasters,
		useItemCategories,
		formatUnit,
		useUnitsOfMeasure
	} from '$lib/features/catalog';
	import {
		useLedgerByItems,
		useLotReservationClaims,
		projectStockLotBalances
	} from '$lib/features/operations';
	import { useItemEvacueeRecipients } from '$lib/features/distribution';
	import { langState } from '$lib/states/i18n.svelte';
	import { formatQty } from '$lib/utils/qty';
	import { useShelterPeopleCounts } from '../application/shelter-people-queries';
	import {
		buildOneTimeDemandRows,
		countCurrentRecipients,
		coverageBarWidth,
		formatCoveragePercent,
		oneTimeItemIds,
		sortOneTimeDemandRows,
		type OneTimeDemandRow
	} from '../domain/one-time-demand';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Eye from '@lucide/svelte/icons/eye';
	import Info from '@lucide/svelte/icons/info';
	import Package from '@lucide/svelte/icons/package';
	import PackageX from '@lucide/svelte/icons/package-x';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import Search from '@lucide/svelte/icons/search';
	import Users from '@lucide/svelte/icons/users';

	let { shelterCode = '' }: { shelterCode?: string | null } = $props();

	const itemMastersQuery = useItemMasters();
	const unitsQuery = useUnitsOfMeasure();
	const categoriesQuery = useItemCategories();
	// Read the ledger of the one-time items only, after the item list says which they are.
	const itemIds = $derived(oneTimeItemIds(itemMastersQuery.data ?? []));
	const ledgerQuery = useLedgerByItems(
		() => itemIds,
		() => itemMastersQuery.isSuccess
	);
	const reservationsQuery = useLotReservationClaims();
	const recipientsQuery = useItemEvacueeRecipients(
		() => itemIds,
		() => itemMastersQuery.isSuccess,
		() => shelterCode ?? undefined
	);
	const peopleQuery = useShelterPeopleCounts(() => shelterCode ?? '');

	const units = $derived(unitsQuery.data ?? []);
	const people = $derived(peopleQuery.data?.total ?? 0);

	const isLoading = $derived(
		itemMastersQuery.isLoading ||
			ledgerQuery.isPending ||
			reservationsQuery.isLoading ||
			recipientsQuery.isPending ||
			peopleQuery.isLoading
	);
	const isError = $derived(
		itemMastersQuery.isError ||
			ledgerQuery.isError ||
			reservationsQuery.isError ||
			recipientsQuery.isError ||
			peopleQuery.isError
	);

	const rows = $derived.by<OneTimeDemandRow[]>(() => {
		if (isLoading || isError) return [];
		return sortOneTimeDemandRows(
			buildOneTimeDemandRows({
				items: itemMastersQuery.data ?? [],
				people,
				lots: projectStockLotBalances(ledgerQuery.data ?? []),
				reservations: reservationsQuery.data ?? [],
				receivedByItem: countCurrentRecipients(
					recipientsQuery.data ?? [],
					peopleQuery.data?.evacueeIds ?? []
				),
				now: Date.now()
			})
		);
	});

	const PAGE_SIZE = 25;
	let search = $state('');
	let visible = $state(PAGE_SIZE);

	// Same pattern as the stock page's attention cards: a card filters the table, a second click clears it.
	type CardFilter = 'all' | 'short' | 'partial' | 'empty';
	let cardFilter = $state<CardFilter>('all');
	function toggleCard(next: Exclude<CardFilter, 'all'>) {
		cardFilter = cardFilter === next ? 'all' : next;
		visible = PAGE_SIZE;
	}

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const byCard = rows.filter((r) =>
			cardFilter === 'short'
				? r.status === 'short'
				: cardFilter === 'partial'
					? partialRows.some((p) => p.itemId === r.itemId)
					: cardFilter === 'empty'
						? emptyRows.some((e) => e.itemId === r.itemId)
						: true
		);
		return q ? byCard.filter((r) => r.name.toLowerCase().includes(q)) : byCard;
	});
	const shown = $derived(filtered.slice(0, visible));
	const ready = $derived(!isLoading && !isError && rows.length > 0);
	const shortRows = $derived(rows.filter((r) => r.status === 'short'));
	const shortCount = $derived(shortRows.length);
	// Short rows with some stock in hand vs none at all, for the summary sentence.
	const partialRows = $derived(shortRows.filter((r) => coverageBarWidth(r.coverage) > 0));
	const emptyRows = $derived(shortRows.filter((r) => r.available === '0'));
	const shortPercent = $derived(rows.length ? Math.round((shortCount / rows.length) * 100) : 0);
	/** Names listed on a card before "and N more". */
	const CARD_NAMES = 3;

	const categoryOfItem = $derived.by(() => {
		const names = new Map((categoriesQuery.data ?? []).map((c) => [c._id, c.name]));
		return new Map(
			(itemMastersQuery.data ?? []).map((item) => [
				item._id,
				// Names read "ไทย (English)"; the Thai part is enough under a product name.
				(item.category ? (names.get(item.category) ?? '') : '').replace(/\s*\(.*\)\s*$/, '')
			])
		);
	});

	/** The stock list on the inventory tab, searched by name; `all` keeps never-received items in view. */
	function stockHref(row: OneTimeDemandRow) {
		const params = new URLSearchParams({ q: row.name, all: '1' });
		return resolve(`/back-office/supply?${params}` as '/back-office/supply');
	}

	function unitLabel(row: OneTimeDemandRow) {
		return formatUnit(row.unit, units, langState.current);
	}
</script>

{#snippet statusBadge(row: OneTimeDemandRow)}
	{#if row.status === 'enough'}
		<Badge variant="outline" class="h-6 gap-1 border-emerald-200 bg-emerald-50 text-emerald-900">
			<CheckCircle2 aria-hidden="true" />
			พอ
		</Badge>
	{:else}
		<Badge variant="outline" class="h-6 gap-1 border-red-200 bg-red-50 text-red-900">
			<AlertCircle aria-hidden="true" />
			ไม่พอ
		</Badge>
	{/if}
{/snippet}

{#snippet coverageMeter(row: OneTimeDemandRow)}
	<div class="min-w-32 space-y-1.5">
		<p class="text-sm font-semibold text-slate-600 tabular-nums">
			{formatCoveragePercent(row.coverage)}
		</p>
		<div
			class="h-2 overflow-hidden rounded-full {row.status === 'enough'
				? 'bg-emerald-100'
				: coverageBarWidth(row.coverage) >= 50
					? 'bg-amber-100'
					: 'bg-slate-200'}"
			role="progressbar"
			aria-label="ครอบคลุม {row.name}"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(coverageBarWidth(row.coverage))}
		>
			<div
				class="h-full rounded-full {row.status === 'enough'
					? 'bg-emerald-500'
					: coverageBarWidth(row.coverage) >= 50
						? 'bg-amber-500'
						: 'bg-red-500'}"
				style:width="{coverageBarWidth(row.coverage)}%"
			></div>
		</div>
	</div>
{/snippet}

{#snippet missingQtyBadge()}
	<Badge variant="outline" class="h-6 gap-1 border-amber-200 bg-amber-50 text-amber-900">
		<AlertTriangle aria-hidden="true" />
		ยังไม่ตั้งจำนวนต่อคน
	</Badge>
{/snippet}

{#snippet viewInStock(row: OneTimeDemandRow)}
	<Button
		variant="outline"
		size="sm"
		href={stockHref(row)}
		aria-label="ดูสินค้า {row.name} ในหน้าสต็อก"
	>
		<Eye aria-hidden="true" />
		ดูในสต็อก
	</Button>
{/snippet}

{#snippet attentionCard(card: {
	filter: Exclude<CardFilter, 'all'>;
	label: string;
	tone: 'critical' | 'warning' | 'neutral' | 'ok';
	icon: typeof AlertCircle;
})}
	{@const isSelected = cardFilter === card.filter}
	{@const list =
		card.filter === 'partial' ? partialRows : card.filter === 'empty' ? emptyRows : shortRows}
	{@const toneNumber = {
		critical: 'text-red-700',
		warning: 'text-amber-700',
		neutral: 'text-slate-900',
		ok: 'text-emerald-700'
	}[card.tone]}
	{@const toneBorder = {
		critical: 'border-red-200 bg-red-50/40',
		warning: 'border-amber-200',
		neutral: 'border-slate-200/80',
		ok: 'border-emerald-200 bg-emerald-50/40'
	}[card.tone]}
	<button
		type="button"
		aria-pressed={isSelected}
		onclick={() => toggleCard(card.filter)}
		class="flex min-h-28 flex-col items-start gap-1 rounded-xl px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {isSelected
			? 'border-2 border-[#0284C7] bg-sky-50'
			: `border bg-white shadow-2xs hover:border-slate-300 ${toneBorder}`}"
	>
		<span class="flex w-full items-center justify-between gap-2">
			<span class="text-sm font-semibold text-slate-700">{card.label}</span>
			<card.icon class="h-4 w-4 shrink-0 {toneNumber}" aria-hidden="true" />
		</span>
		<span class="flex flex-wrap items-baseline gap-x-2">
			<span class="text-3xl font-bold tabular-nums {toneNumber}">{list.length}</span>
			<span class="text-sm text-slate-500">
				{card.filter === 'short' ? `/ ${rows.length}` : 'รายการ'}
			</span>
			{#if card.filter === 'short' && shortCount > 0}
				<Badge variant="destructive" class="h-5">ขาดแคลน {shortPercent}%</Badge>
			{/if}
		</span>
		{#if card.filter === 'short'}
			<span class="text-sm text-slate-600">
				{shortCount === 0
					? 'พอแจกทุกรายการ'
					: shortCount === rows.length
						? 'ทุกรายการยังไม่พอ'
						: `${rows.length - shortCount} รายการพอแล้ว`}
			</span>
		{:else if list.length > 0}
			<span class="flex w-full flex-col gap-1">
				{#each list.slice(0, CARD_NAMES) as row (row.itemId)}
					<span
						class="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm {card.filter ===
						'partial'
							? 'border border-amber-200 bg-amber-50 text-amber-900'
							: 'bg-slate-100 text-slate-700'}"
					>
						<span class="truncate">{row.name}</span>
						{#if card.filter === 'partial'}
							<span class="font-semibold tabular-nums">{formatCoveragePercent(row.coverage)}</span>
						{/if}
					</span>
				{/each}
				{#if list.length > CARD_NAMES}
					<span class="text-xs text-slate-500">และอีก {list.length - CARD_NAMES} รายการ</span>
				{/if}
			</span>
		{/if}
	</button>
{/snippet}

<div class="space-y-4">
	<section
		aria-label="สรุปความพร้อมแจกจ่าย"
		class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
	>
		<Card.Root class="gap-1 px-4 py-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="text-sm font-semibold text-slate-700">ประชากรในศูนย์</span>
				<Users class="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
			</div>
			<p class="text-3xl font-bold text-slate-900 tabular-nums">
				{formatQty(people)}
				<span class="text-sm font-medium text-slate-500">คนทั้งหมด</span>
			</p>
			{#if peopleQuery.data}
				<p class="flex flex-wrap gap-x-2 text-sm text-slate-600">
					<span class="whitespace-nowrap">
						ผู้พักพิง <span class="font-semibold tabular-nums"
							>{formatQty(peopleQuery.data.evacuees)}</span
						>
					</span>
					<span class="whitespace-nowrap">
						เจ้าหน้าที่ <span class="font-semibold tabular-nums"
							>{formatQty(peopleQuery.data.staff)}</span
						>
					</span>
					<span class="whitespace-nowrap">
						จิตอาสา <span class="font-semibold tabular-nums"
							>{formatQty(peopleQuery.data.volunteers)}</span
						>
					</span>
				</p>
			{/if}
		</Card.Root>

		{#if ready}
			{@render attentionCard({
				filter: 'short',
				label: 'รายการที่ยังไม่พอ',
				tone: shortCount > 0 ? 'critical' : 'ok',
				icon: AlertCircle
			})}
			{@render attentionCard({
				filter: 'partial',
				label: 'พร้อมแจกจ่ายบางส่วน',
				tone: 'warning',
				icon: Package
			})}
			{@render attentionCard({
				filter: 'empty',
				label: 'สต็อกเป็นศูนย์',
				tone: 'neutral',
				icon: PackageX
			})}
		{/if}
	</section>

	{#if isLoading}
		<Card.Root>
			<Card.Content class="py-6 text-center text-base text-slate-600" role="status">
				กำลังโหลดข้อมูล…
			</Card.Content>
		</Card.Root>
	{:else if isError}
		<Alert.Root variant="destructive" class="border-red-200 px-4 py-3" role="alert">
			<AlertCircle aria-hidden="true" />
			<Alert.Description class="text-base">
				โหลดข้อมูลของแจกครั้งเดียวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
			</Alert.Description>
		</Alert.Root>
	{:else if rows.length === 0}
		<Card.Root>
			<Card.Content class="flex flex-col items-center py-8 text-center">
				<PackageOpen class="mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
				<p class="text-base font-semibold text-slate-700">ยังไม่มีสินค้าประเภทแจกครั้งเดียว</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root class="gap-0 py-0">
			<div class="flex flex-wrap items-center justify-between gap-3 p-4">
				<div class="relative w-full sm:w-80">
					<Search
						class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
						aria-hidden="true"
					/>
					<Input
						type="search"
						class="pl-9"
						placeholder="ค้นหาชื่อสินค้า (เช่น เต็นท์, มุ้ง)..."
						aria-label="ค้นหาสินค้า"
						bind:value={search}
						oninput={() => (visible = PAGE_SIZE)}
					/>
				</div>
				<p class="text-sm text-slate-500">
					แสดง {shown.length} จาก {filtered.length} รายการ
				</p>
			</div>

			<!-- Mobile: one card per item -->
			<ul class="space-y-2.5 border-t border-slate-200/80 p-3 md:hidden">
				{#each shown as row (row.itemId)}
					<li
						class="rounded-xl border bg-white p-3.5 {row.status === 'short'
							? 'border-red-200'
							: 'border-slate-200/80'}"
					>
						<div class="flex items-start justify-between gap-2">
							<div>
								<span class="text-base font-semibold text-slate-900">{row.name}</span>
								{#if categoryOfItem.get(row.itemId)}
									<p class="text-sm text-slate-500">{categoryOfItem.get(row.itemId)}</p>
								{/if}
							</div>
							{@render statusBadge(row)}
						</div>
						{#if row.qtyPerPersonMissing}
							<div class="mt-1.5">{@render missingQtyBadge()}</div>
						{/if}
						<dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
							<div>
								<dt class="text-slate-500">รับแล้ว</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatQty(row.received)} คน
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">ต้องแจกอีก</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatQty(row.demand)}
									{unitLabel(row)}
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">มีพร้อมแจก</dt>
								<dd class="font-semibold text-slate-900 tabular-nums">
									{formatQty(row.available)}
									{unitLabel(row)}
								</dd>
							</div>
							<div>
								<dt class="text-slate-500">ต้องหาเพิ่ม</dt>
								<dd
									class="font-semibold tabular-nums {row.status === 'short'
										? 'text-red-700'
										: 'text-slate-900'}"
								>
									{formatQty(row.shortfall)}
									{unitLabel(row)}
								</dd>
							</div>
							<div class="col-span-2">
								<dt class="sr-only">ครอบคลุม</dt>
								<dd>{@render coverageMeter(row)}</dd>
							</div>
						</dl>
						<div class="mt-3 flex justify-end">{@render viewInStock(row)}</div>
					</li>
				{/each}
			</ul>

			<!-- Tablet / desktop table -->
			<div class="hidden overflow-x-auto border-t border-slate-200/80 md:block">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-slate-50">
							<Table.Head class="px-4 py-3">รายการสินค้า</Table.Head>
							<Table.Head class="px-4 py-3 text-right">รับแล้ว</Table.Head>
							<Table.Head class="px-4 py-3 text-right">ต้องแจกอีก</Table.Head>
							<Table.Head class="px-4 py-3 text-right">มีพร้อมแจก</Table.Head>
							<Table.Head class="px-4 py-3 text-right text-red-700">ต้องหาเพิ่ม</Table.Head>
							<Table.Head class="px-4 py-3">ความครอบคลุม</Table.Head>
							<Table.Head class="px-4 py-3 text-center">สถานะ</Table.Head>
							<Table.Head class="px-4 py-3 text-center">จัดการ</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each shown as row (row.itemId)}
							<Table.Row>
								<Table.Cell class="px-4 py-3">
									<span class="text-base font-semibold text-slate-900">{row.name}</span>
									{#if categoryOfItem.get(row.itemId)}
										<p class="text-sm text-slate-500">{categoryOfItem.get(row.itemId)}</p>
									{/if}
									{#if row.qtyPerPersonMissing}
										<div class="mt-1">{@render missingQtyBadge()}</div>
									{/if}
								</Table.Cell>
								<Table.Cell class="px-4 py-3 text-right text-base tabular-nums">
									{formatQty(row.received)}
									<span class="text-sm text-slate-500">คน</span>
								</Table.Cell>
								<Table.Cell class="px-4 py-3 text-right text-base font-semibold tabular-nums">
									{formatQty(row.demand)}
									<span class="text-sm font-normal text-slate-500">{unitLabel(row)}</span>
								</Table.Cell>
								<Table.Cell
									class="px-4 py-3 text-right text-base font-semibold tabular-nums {row.available ===
									'0'
										? 'text-slate-900'
										: 'text-sky-700'}"
								>
									{formatQty(row.available)}
									<span class="text-sm font-normal text-slate-500">{unitLabel(row)}</span>
								</Table.Cell>
								<Table.Cell
									class="px-4 py-3 text-right text-base font-semibold tabular-nums {row.status ===
									'short'
										? 'text-red-700'
										: 'text-slate-900'}"
								>
									{formatQty(row.shortfall)}
									<span class="text-sm font-normal text-slate-500">{unitLabel(row)}</span>
								</Table.Cell>
								<Table.Cell class="px-4 py-3">{@render coverageMeter(row)}</Table.Cell>
								<Table.Cell class="px-4 py-3 text-center">{@render statusBadge(row)}</Table.Cell>
								<Table.Cell class="px-4 py-3 text-center">{@render viewInStock(row)}</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			<div
				class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50 px-4 py-3 text-sm text-slate-500"
			>
				<p class="flex items-center gap-1.5">
					<Info class="h-4 w-4 shrink-0" aria-hidden="true" />
					"ต้องหาเพิ่ม" คำนวณจาก: ยอดที่ต้องแจกอีก ลบด้วย ยอดที่มีพร้อมแจกในคลัง
				</p>
				{#if filtered.length === 0}
					<p>ไม่พบสินค้าที่ค้นหา</p>
				{:else if filtered.length > shown.length}
					<Button variant="outline" size="sm" onclick={() => (visible += PAGE_SIZE)}>
						ดูเพิ่ม
					</Button>
				{/if}
			</div>
		</Card.Root>
	{/if}
</div>
