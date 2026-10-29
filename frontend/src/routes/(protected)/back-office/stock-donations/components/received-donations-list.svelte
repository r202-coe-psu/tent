<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import Mail from '@lucide/svelte/icons/mail';
	import Phone from '@lucide/svelte/icons/phone';
	import Search from '@lucide/svelte/icons/search';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import {
		donationActionRef,
		donationRefLabel,
		type PendingDonationRow,
		type ReceivedSearchBy,
		type ReceivedSearchTerm
	} from '$lib/features/donations';
	import { ItemCombobox, useStockFormItems } from '$lib/features/operations';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';

	/** A submitted search: what the server is asked, plus what to call it on screen. */
	export type SubmittedReceivedSearch = ReceivedSearchTerm & { label: string };

	/**
	 * "รับแล้ว" (#821) — donations already received, newest first, laid out like the other
	 * queue filters (filter bar, cards below md, table from md). The rows arrive from the server
	 * with the donor contact already masked (FR-10) and are shown as they are; the full contact
	 * is on the detail view only. Paged by the server: "โหลดเพิ่ม" asks for more.
	 *
	 * The search box asks the server (FR-8): one type at a time, sent on Enter / the button, never
	 * per keystroke. The page owns the submitted search and feeds this list the rows it found.
	 */
	let {
		rows,
		shelterCode = '',
		searchTerm = null,
		loading = false,
		error = null,
		hasMore = false,
		loadingMore = false,
		onLoadMore,
		onRetry,
		onSearch,
		onClearSearch,
		onViewDetails
	}: {
		rows: PendingDonationRow[];
		/** Shelter whose catalog the item picker lists. */
		shelterCode?: string;
		/** The search the rows answer, or `null` for the plain list. */
		searchTerm?: SubmittedReceivedSearch | null;
		loading?: boolean;
		error?: string | null;
		hasMore?: boolean;
		loadingMore?: boolean;
		onLoadMore: () => void;
		onRetry?: () => void;
		onSearch: (term: SubmittedReceivedSearch) => void;
		onClearSearch: () => void;
		onViewDetails: (row: PendingDonationRow) => void;
	} = $props();

	const RECEIVED_BADGE = 'border-emerald-200 bg-emerald-50 text-emerald-900';

	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

	const SEARCH_TYPES: { value: ReceivedSearchBy; label: string; placeholder: string }[] = [
		{ value: 'booking_ref', label: 'เลขใบ', placeholder: 'เลขใบเต็ม เช่น DN-306892' },
		{ value: 'name', label: 'ชื่อผู้บริจาค', placeholder: 'ชื่อ นามสกุล หรือชื่อเต็ม (ตรงทั้งคำ)' },
		{ value: 'phone', label: 'เบอร์โทร', placeholder: 'เบอร์เต็ม 10 หลัก เช่น 0812345678' },
		{ value: 'item', label: 'สินค้า', placeholder: 'เลือกสินค้า' },
		{ value: 'lot', label: 'เลขล็อต', placeholder: 'เช่น L-261029-001' }
	];

	// The form is a draft: nothing is asked until it is submitted.
	// It starts from the search that is showing (coming back from a detail view remounts the list).
	// svelte-ignore state_referenced_locally
	let by = $state<ReceivedSearchBy>(searchTerm?.by ?? 'booking_ref');
	// svelte-ignore state_referenced_locally
	let text = $state(searchTerm && searchTerm.by !== 'item' ? searchTerm.q : '');
	// svelte-ignore state_referenced_locally
	let itemId = $state(searchTerm?.by === 'item' ? searchTerm.q : '');
	// svelte-ignore state_referenced_locally
	let itemName = $state(searchTerm?.by === 'item' ? searchTerm.label : '');

	const searching = $derived(searchTerm !== null);
	const typeInfo = $derived(SEARCH_TYPES.find((t) => t.value === by) ?? SEARCH_TYPES[0]);
	const canSubmit = $derived(by === 'item' ? itemId !== '' : text.trim() !== '');

	const stockItems = useStockFormItems(() => shelterCode);

	function chooseType(value: string) {
		by = value as ReceivedSearchBy;
		text = '';
		itemId = '';
		itemName = '';
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		const q = by === 'item' ? itemId : text.trim();
		onSearch({ by, q, label: by === 'item' ? itemName : q });
	}

	function clear() {
		text = '';
		itemId = '';
		itemName = '';
		onClearSearch();
	}

	/** What was received (counted, turned-away lines left out); declared items on older docs. */
	function itemsSummary(row: PendingDonationRow): string {
		const lines = row.received_items ?? row.items;
		if (lines.length === 0) return '—';
		return lines
			.map(
				(it) =>
					`${it.free_text ?? it.item_id ?? 'ไม่ระบุ'} ${it.qty} ${formatUnit(it.unit, units, langState.current)}`
			)
			.join(', ');
	}

	/** Same shape as the queue's "ส่งเมื่อ …", for when the donation was received. */
	function formatReceivedAgo(dateStr?: string | null): string {
		if (!dateStr) return '—';
		const parsed = Date.parse(dateStr);
		if (Number.isNaN(parsed)) return '—';
		const diffMins = Math.floor((Date.now() - parsed) / 60000);
		if (diffMins < 1) return 'รับเมื่อสักครู่';
		if (diffMins < 60) return `รับเมื่อ ${diffMins} นาทีที่แล้ว`;
		const diffHours = Math.floor(diffMins / 60);
		if (diffHours < 24) return `รับเมื่อ ${diffHours} ชั่วโมงที่แล้ว`;
		return `รับเมื่อ ${Math.floor(diffHours / 24)} วันที่แล้ว`;
	}
</script>

{#snippet contact(row: PendingDonationRow)}
	<span class="flex items-center gap-1.5 tabular-nums">
		<Phone class="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
		<span class="sr-only">เบอร์โทร</span>
		{row.donor_phone ?? 'ไม่ระบุเบอร์โทร'}
	</span>
	<span class="flex items-center gap-1.5 break-all">
		<Mail class="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
		<span class="sr-only">อีเมล</span>
		{row.donor_email ?? 'ไม่ระบุอีเมล'}
	</span>
{/snippet}

{#snippet loadError()}
	<div
		class="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-white p-6 text-center"
		role="alert"
	>
		<p class="text-base font-semibold text-red-900">
			{searching ? 'ค้นหารายการที่รับแล้วไม่สำเร็จ' : 'โหลดรายการที่รับแล้วไม่สำเร็จ'}
		</p>
		<p class="text-sm text-slate-600">{error}</p>
		{#if onRetry}
			<Button type="button" variant="outline" class="min-h-11" onclick={onRetry}>ลองใหม่</Button>
		{/if}
	</div>
{/snippet}

{#snippet emptyText()}
	{#if searchTerm}
		ไม่พบรายการที่ตรงกับ "{searchTerm.label}"
	{:else}
		ยังไม่มีรายการของบริจาคที่รับแล้ว
	{/if}
{/snippet}

<!-- Filter Bar — same geometry as the other queue filters; the search asks the server -->
<div class="border-b border-border/60 bg-card p-4">
	<form class="flex flex-col gap-2 md:flex-row md:items-end" onsubmit={submit} role="search">
		<div class="md:w-44">
			<label for="received-search-by" class="mb-1 block text-xs font-medium text-muted-foreground">
				ค้นหาด้วย
			</label>
			<Select.Root type="single" value={by} onValueChange={chooseType}>
				<Select.Trigger
					id="received-search-by"
					class="h-9 w-full rounded-xl text-xs data-[size=default]:h-9"
				>
					{typeInfo.label}
				</Select.Trigger>
				<Select.Content>
					{#each SEARCH_TYPES as type (type.value)}
						<Select.Item value={type.value} label={type.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<div class="min-w-0 flex-1">
			<label for="received-search" class="mb-1 block text-xs font-medium text-muted-foreground">
				ค้นทั้งศูนย์ — ตรงทั้งคำ ไม่ค้นบางส่วน
			</label>
			{#if by === 'item'}
				<ItemCombobox
					id="received-search"
					items={stockItems.items}
					isLoading={stockItems.isLoading}
					bind:value={itemId}
					placeholder={typeInfo.placeholder}
					onSelect={(item) => (itemName = item?.name ?? '')}
				/>
			{:else}
				<div class="relative">
					<Search
						class="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						id="received-search"
						type="text"
						placeholder={typeInfo.placeholder}
						bind:value={text}
						class="h-9 rounded-xl pl-9 text-xs"
					/>
				</div>
			{/if}
		</div>

		<div class="flex gap-2">
			<Button type="submit" class="min-h-9 rounded-xl" disabled={!canSubmit || loading}>
				ค้นหา
			</Button>
			{#if searching}
				<Button type="button" variant="outline" class="min-h-9 rounded-xl" onclick={clear}>
					ล้าง
				</Button>
			{/if}
		</div>
	</form>
</div>

<!-- Mobile cards (< md) -->
<div class="space-y-3 p-4 md:hidden">
	{#if loading}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-500 shadow-2xs"
		>
			กำลังโหลดข้อมูล...
		</div>
	{:else if error}
		{@render loadError()}
	{:else if rows.length === 0}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-500 shadow-2xs"
		>
			{@render emptyText()}
		</div>
	{:else}
		{#each rows as row (donationActionRef(row) ?? row.received_at)}
			<article class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
				<div>
					<div class="text-base font-bold text-slate-900">{row.donor_name || 'ไม่ระบุชื่อ'}</div>
					<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
						<Badge variant="outline" class="text-xs font-bold {RECEIVED_BADGE}">รับแล้ว</Badge>
						<span class="font-semibold text-slate-500">{donationRefLabel(row)}</span>
						<span class="text-slate-400">·</span>
						<span class="text-slate-500">{formatReceivedAgo(row.received_at)}</span>
					</div>
				</div>

				<div class="rounded-lg border border-slate-200/80 bg-slate-50/80 p-3">
					<p class="text-xs font-semibold text-slate-500">รายการที่รับ</p>
					<p class="mt-1 text-sm font-medium text-slate-800">{itemsSummary(row)}</p>
				</div>

				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
					{@render contact(row)}
				</div>

				<Button
					variant="outline"
					type="button"
					onclick={() => onViewDetails(row)}
					class="min-h-11 w-full gap-1.5 rounded-xl border-sky-200 bg-sky-50 px-3.5 text-sm font-bold text-sky-900 hover:bg-sky-100"
				>
					<Eye class="h-4 w-4" />
					ดูรายละเอียด
				</Button>
			</article>
		{/each}
	{/if}
</div>

<!-- Desktop table (md+) -->
<div class="hidden overflow-x-auto md:block">
	<Table.Root class="w-full border-collapse text-left">
		<Table.Header>
			<Table.Row class="border-b border-border bg-muted/15 text-xs font-bold text-muted-foreground">
				<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
					>ผู้ส่งและรหัสคำขอ (DONOR INFO)</Table.Head
				>
				<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
					>รายการที่รับ (ITEMS RECEIVED)</Table.Head
				>
				<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
					>ติดต่อผู้บริจาค (CONTACT)</Table.Head
				>
				<Table.Head class="px-6 py-4 text-right text-xs font-bold text-foreground/80"
					>การจัดการ (ACTION)</Table.Head
				>
			</Table.Row>
		</Table.Header>
		<Table.Body class="divide-y divide-border/60 text-xs">
			{#if loading}
				<Table.Row>
					<Table.Cell colspan={4} class="px-6 py-12 text-center text-muted-foreground">
						กำลังโหลดข้อมูล...
					</Table.Cell>
				</Table.Row>
			{:else if error}
				<Table.Row>
					<Table.Cell colspan={4} class="px-6 py-8">{@render loadError()}</Table.Cell>
				</Table.Row>
			{:else if rows.length === 0}
				<Table.Row>
					<Table.Cell colspan={4} class="px-6 py-12 text-center text-muted-foreground">
						{@render emptyText()}
					</Table.Cell>
				</Table.Row>
			{:else}
				{#each rows as row (donationActionRef(row) ?? row.received_at)}
					<Table.Row class="transition-colors hover:bg-muted/10">
						<Table.Cell class="min-w-[240px] px-6 py-4">
							<div class="text-sm font-bold text-foreground">{row.donor_name || 'ไม่ระบุชื่อ'}</div>
							<div class="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
								<Badge variant="outline" class="text-2xs font-bold {RECEIVED_BADGE}">รับแล้ว</Badge>
								<span class="font-semibold text-muted-foreground">{donationRefLabel(row)}</span>
								<span class="text-muted-foreground">·</span>
								<span class="text-muted-foreground">{formatReceivedAgo(row.received_at)}</span>
							</div>
						</Table.Cell>

						<Table.Cell class="min-w-[260px] px-6 py-4 text-xs font-medium text-foreground">
							{itemsSummary(row)}
						</Table.Cell>

						<Table.Cell class="min-w-[200px] px-6 py-4">
							<div class="flex flex-col gap-1 text-xs text-muted-foreground">
								{@render contact(row)}
							</div>
						</Table.Cell>

						<Table.Cell class="px-6 py-4 text-right">
							<Button
								variant="outline"
								type="button"
								onclick={() => onViewDetails(row)}
								class="h-9 gap-1.5 rounded-xl border-blue-200 bg-blue-50/80 px-3.5 text-xs font-bold text-blue-700 hover:bg-blue-100 hover:text-blue-800"
							>
								<Eye class="h-3.5 w-3.5" />
								ดูรายละเอียด
							</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			{/if}
		</Table.Body>
	</Table.Root>
</div>

{#if !loading && !error && rows.length > 0}
	<!-- Footer — same place and tone as the queue's pagination footer -->
	<div
		class="flex flex-col items-center justify-between gap-3 border-t border-border/60 p-4 sm:flex-row"
	>
		<p class="text-2xs text-muted-foreground" aria-live="polite" data-testid="received-count">
			{searching ? 'พบ' : 'แสดง'}
			<span class="tabular-nums">{rows.length}</span>
			รายการ{hasMore ? ' (ยังมีอีก)' : ''}
		</p>
		{#if hasMore}
			<Button
				type="button"
				variant="outline"
				class="min-h-11 rounded-xl"
				disabled={loadingMore}
				onclick={onLoadMore}
			>
				{loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
			</Button>
		{/if}
	</div>
{/if}
