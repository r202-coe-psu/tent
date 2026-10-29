<script lang="ts">
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import {
		matchesStatusFilter,
		parseCampaignNotes,
		publicItemAggregate,
		type NeedCloseState,
		type NeedItem,
		type NeedStatusFilter
	} from '$lib/features/operations';
	import { addQty, formatQty, parseQty, qtyIsZero } from '$lib/utils/qty';
	import { DEFAULT_ITEM_UNIT, formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import BoardSectionHeader from '$lib/components/board-section-header.svelte';

	let {
		items = [],
		onAddRequest,
		onToggleShowOnHome,
		onToggleCutOff,
		onEdit
	}: {
		items: NeedItem[];
		onAddRequest: () => void;
		onToggleShowOnHome: (id: string) => void;
		onToggleCutOff: (id: string, itemId: string) => void;
		/** One row = one need, so the edited item travels with the campaign. */
		onEdit?: (item: NeedItem, itemId: string) => void;
	} = $props();

	const uid = $props.id();
	const statusId = `${uid}-status`;
	const sortId = `${uid}-sort`;

	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

	let searchQuery = $state('');
	let statusFilter = $state<NeedStatusFilter>('all');
	let sortOrder = $state<'progress_asc' | 'progress_desc' | 'name'>('progress_asc');

	const STATUS_OPTIONS: { value: NeedStatusFilter; label: string }[] = [
		{ value: 'all', label: 'ทั้งหมด' },
		{ value: 'showing', label: 'กำลังโชว์บนหน้าเว็บ' },
		{ value: 'hidden', label: 'ซ่อนจากหน้าเว็บ' },
		{ value: 'reached', label: 'ครบถ้วน' },
		{ value: 'closed', label: 'Force Cut-off' }
	];
	const SORT_OPTIONS = [
		{ value: 'progress_asc', label: 'ความคืบหน้าน้อยไปมาก' },
		{ value: 'progress_desc', label: 'ความคืบหน้ามากไปน้อย' },
		{ value: 'name', label: 'ชื่อ ก-ฮ' }
	] as const;

	const statusLabel = $derived(
		STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter
	);
	const sortLabel = $derived(SORT_OPTIONS.find((o) => o.value === sortOrder)?.label ?? sortOrder);

	// Flatten rows for individual needs display
	type FlatNeedRow = {
		compoundId: string;
		itemId: string;
		title: string;
		/** Raw `donation_campaign.notes` — kept for the search filter. */
		location: string;
		/** Just the blurb staff typed; the tags encoded around it are shown elsewhere. */
		description: string;
		name: string;
		unit: string;
		reserved: string;
		onHand: string;
		target: string;
		remaining: string;
		progressPercent: number;
		showOnHome: boolean;
		/** Badge, bar, buttons and filter all read this one value (#817). */
		state: NeedCloseState;
		isManualClosed: boolean;
		originalItem: NeedItem;
		/** How many open campaigns share this item on the donor-facing board. */
		sharedCampaigns: number;
		/** The single number donors actually see for it. */
		publicTotal: string;
	};

	const campaignDocs = $derived(items.map((i) => i.campaignDoc));

	const flatRows = $derived.by(() => {
		const rows: FlatNeedRow[] = [];
		for (const item of items) {
			if (!item.needs || item.needs.length === 0) {
				rows.push({
					compoundId: item.id,
					itemId: '',
					title: item.title,
					location: item.location,
					description: parseCampaignNotes(item.location).description ?? '',
					name: item.title,
					unit: DEFAULT_ITEM_UNIT,
					reserved: '0',
					onHand: '0',
					target: '0',
					remaining: '0',
					progressPercent: 0,
					showOnHome: item.showOnHome,
					state: item.closeState,
					isManualClosed: item.isManualClosed,
					originalItem: item,
					sharedCampaigns: 0,
					publicTotal: '0'
				});
			} else {
				for (const need of item.needs) {
					// The public board is keyed per ITEM, so several campaigns asking for the
					// same thing show up there as one card with one total (schema.md §2.4).
					const aggregate = publicItemAggregate(campaignDocs, need.itemId);
					const totalAcquired = addQty(need.reserved, need.onHand);
					const progress = qtyIsZero(need.target)
						? 0
						: Math.min(
								Math.round(parseQty(totalAcquired).div(need.target).times(100).toNumber()),
								100
							);
					rows.push({
						compoundId: item.id,
						itemId: need.itemId,
						title: need.name || item.title,
						location: item.location,
						description: parseCampaignNotes(item.location).description ?? '',
						name: need.name,
						unit: need.unit || DEFAULT_ITEM_UNIT,
						reserved: need.reserved,
						onHand: need.onHand,
						target: need.target,
						remaining: need.remaining,
						progressPercent: progress,
						showOnHome: item.showOnHome,
						state: need.closeState,
						isManualClosed: need.isManualClosed,
						originalItem: item,
						sharedCampaigns: aggregate.campaignCount,
						publicTotal: aggregate.totalTarget
					});
				}
			}
		}

		// Filter
		let filtered = rows.filter((r) => {
			const q = searchQuery.toLowerCase().trim();
			if (q) {
				const matchName = r.title.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
				const matchLoc = r.location.toLowerCase().includes(q);
				if (!matchName && !matchLoc) return false;
			}

			return matchesStatusFilter(r.state, r.showOnHome, statusFilter);
		});

		// Sort
		filtered.sort((a, b) => {
			if (sortOrder === 'progress_asc') return a.progressPercent - b.progressPercent;
			if (sortOrder === 'progress_desc') return b.progressPercent - a.progressPercent;
			return a.title.localeCompare(b.title);
		});

		return filtered;
	});

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	// A filter change can leave the view past the last page — go back to the start
	// rather than render an empty table over rows that do exist.
	const pageCount = $derived(Math.max(1, Math.ceil(flatRows.length / PAGE_SIZE)));
	const safePage = $derived(Math.min(currentPage, pageCount));
	const pagedRows = $derived(flatRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE));
</script>

<div class="space-y-4">
	<!-- Main Container Card -->
	<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
		<BoardSectionHeader
			icon={Megaphone}
			title="จัดการกระดานแจ้งความต้องการด่วน (Public Needs Board)"
			description="สับสวิตช์เปิด-ปิด หรือจำกัดจำนวนรายการสิ่งของที่ศูนย์ต้องการแจ้งให้สาธารณชนรับทราบผ่านทางหน้าเว็บแรก"
		>
			{#snippet actions()}
				<Button
					type="button"
					onclick={onAddRequest}
					class="h-auto min-h-11 w-full gap-2 rounded-xl bg-[#0A2647] px-5 text-sm font-bold whitespace-normal text-white shadow-2xs hover:bg-[#051930] sm:w-auto"
				>
					<Plus class="h-4 w-4" />
					<span class="sm:hidden">สร้างประกาศเอง</span>
					<span class="hidden sm:inline">สร้างประกาศแบบกำหนดเอง (Special Request)</span>
				</Button>
			{/snippet}
		</BoardSectionHeader>

		<!-- Filter Bar -->
		<div class="border-b border-border/60 bg-card p-4">
			<div class="flex flex-col gap-3 md:flex-row md:items-end">
				<!-- Search input -->
				<div class="relative flex-1">
					<Search
						class="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="text"
						placeholder="ค้นหาชื่อสินค้า/รายการประกาศ..."
						bind:value={searchQuery}
						class="h-9 rounded-xl pl-9 text-xs"
					/>
				</div>

				<!-- Filter dropdowns -->
				<div class="flex flex-wrap items-end gap-2">
					<div class="space-y-1">
						<Label
							id="{statusId}-label"
							for={statusId}
							class="text-xs font-semibold text-slate-600"
						>
							สถานะ
						</Label>
						<Select.Root type="single" bind:value={statusFilter}>
							<!-- Label + own text, so a screen reader also hears the selected value. -->
							<Select.Trigger
								id={statusId}
								aria-labelledby="{statusId}-label {statusId}"
								class="h-9 rounded-xl text-xs data-[size=default]:h-9"
							>
								{statusLabel}
							</Select.Trigger>
							<Select.Content>
								{#each STATUS_OPTIONS as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<div class="space-y-1">
						<Label id="{sortId}-label" for={sortId} class="text-xs font-semibold text-slate-600">
							เรียง
						</Label>
						<Select.Root type="single" bind:value={sortOrder}>
							<Select.Trigger
								id={sortId}
								aria-labelledby="{sortId}-label {sortId}"
								class="h-9 rounded-xl text-xs data-[size=default]:h-9"
							>
								{sortLabel}
							</Select.Trigger>
							<Select.Content>
								{#each SORT_OPTIONS as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
			</div>
		</div>

		<!-- Mobile cards (< md) -->
		<div class="space-y-3 p-4 md:hidden">
			{#if flatRows.length === 0}
				<div
					class="rounded-xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-500 shadow-2xs"
				>
					ไม่พบรายการความต้องการที่ค้นหา
				</div>
			{:else}
				{#each pagedRows as row (row.compoundId + row.itemId)}
					<article
						class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs {row.state !==
						'open'
							? 'opacity-70'
							: ''}"
					>
						<div class="space-y-1.5">
							<div class="flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
								{#if row.state === 'reached'}
									<Badge
										variant="outline"
										class="border-success-border bg-success-muted text-xs font-extrabold text-success-dark"
										>ครบถ้วน</Badge
									>
								{:else if row.state === 'closed'}
									<Badge variant="destructive" class="text-xs font-extrabold">CUT-OFF</Badge>
								{/if}
								{row.title}
							</div>
							{#if row.description}
								<p class="line-clamp-2 text-sm break-words text-slate-500" title={row.description}>
									{row.description}
								</p>
							{/if}
							{#if row.sharedCampaigns > 1}
								<Badge
									class="mt-1 h-auto border border-sky-200 bg-sky-50 py-0.5 text-xs font-bold whitespace-normal text-sky-900"
									title="หน้าบริจาคสาธารณะรวมทุกประกาศที่ขอสิ่งของเดียวกันเป็นการ์ดใบเดียว"
								>
									รวมกับอีก {row.sharedCampaigns - 1} ประกาศบนหน้า public · รวม {formatQty(
										row.publicTotal
									)}
									{formatUnit(row.unit, units, langState.current)}
								</Badge>
							{/if}
						</div>

						<div class="grid grid-cols-2 gap-2">
							{#each [{ label: 'จองแล้ว', value: row.reserved }, { label: 'ในคลัง', value: row.onHand }, { label: 'เป้าหมาย', value: row.target }, { label: 'คงเหลือรับได้', value: row.remaining }] as stat (stat.label)}
								<div class="rounded-lg border border-slate-200/80 bg-slate-50/80 p-2.5 text-center">
									<p class="text-xs font-semibold text-slate-500">{stat.label}</p>
									<p class="mt-1 text-sm font-bold text-slate-900 tabular-nums">
										{formatQty(stat.value || '0')}
										<span class="text-xs font-medium text-slate-500"
											>{formatUnit(row.unit, units, langState.current)}</span
										>
									</p>
								</div>
							{/each}
						</div>

						<div class="space-y-1.5">
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-semibold text-slate-500">ความคืบหน้า</span>
								<span class="text-xs font-bold text-slate-800 tabular-nums"
									>{row.progressPercent}%</span
								>
							</div>
							<div class="relative h-2.5 overflow-hidden rounded-full bg-slate-100">
								<div
									class="h-full rounded-full transition-all duration-300 {row.state === 'reached'
										? 'bg-success'
										: row.state === 'closed'
											? 'bg-red-600'
											: 'bg-[#0A2647]'}"
									style="width: {row.progressPercent}%"
								></div>
							</div>
						</div>

						<div class="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
							<!-- Same row state as the badge and bar (#817). -->
							<Button
								variant="outline"
								type="button"
								onclick={() => onToggleShowOnHome(row.compoundId)}
								disabled={row.state !== 'open'}
								class="min-h-11 w-full rounded-xl px-3 text-sm font-bold sm:w-auto
								{row.showOnHome && row.state === 'open'
									? 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100'
									: 'border-slate-200 bg-slate-100 text-slate-500 opacity-70'}"
							>
								{row.showOnHome && row.state === 'open' ? 'กำลังโชว์บนหน้าเว็บ' : 'ซ่อนจากหน้าเว็บ'}
							</Button>

							{#if onEdit && row.itemId}
								<Button
									variant="outline"
									type="button"
									onclick={() => onEdit(row.originalItem, row.itemId)}
									class="min-h-11 w-full gap-1 rounded-xl border-sky-200 bg-sky-50 px-3 text-sm font-bold text-sky-900 hover:bg-sky-100 sm:w-auto"
								>
									<SlidersHorizontal class="h-3.5 w-3.5" />
									แก้ไข
								</Button>
							{/if}

							{#if row.itemId}
								{#if row.state === 'reached'}
									<Button
										variant="outline"
										type="button"
										disabled
										class="min-h-11 w-full rounded-xl border-slate-200 bg-slate-100 px-3 text-sm font-bold text-slate-500 sm:w-auto"
									>
										ปิดอัตโนมัติ (ครบเป้า)
									</Button>
								{:else if row.state === 'open' || row.isManualClosed}
									<Button
										variant="outline"
										type="button"
										onclick={() => onToggleCutOff(row.compoundId, row.itemId)}
										class="min-h-11 w-full rounded-xl px-3 text-sm font-bold sm:w-auto
										{row.isManualClosed
											? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
											: 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'}"
									>
										{row.isManualClosed ? 'เปิดรับบริจาค (Restore)' : 'Force Cut-off'}
									</Button>
								{/if}
							{/if}
						</div>
					</article>
				{/each}
			{/if}
		</div>

		<!-- Desktop table (md+) -->
		<div class="hidden overflow-x-auto md:block">
			<Table.Root class="w-full border-collapse text-left">
				<Table.Header>
					<Table.Row
						class="border-b border-border bg-muted/15 text-xs font-bold text-muted-foreground"
					>
						<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
							>รายการพัสดุ / ประกาศพิเศษ</Table.Head
						>
						<Table.Head class="px-3 py-4 text-center text-xs font-bold text-foreground/80"
							>ยอดจองบริจาคแล้ว</Table.Head
						>
						<Table.Head class="px-3 py-4 text-center text-xs font-bold text-foreground/80"
							>ยอดในคลัง</Table.Head
						>
						<Table.Head class="px-3 py-4 text-center text-xs font-bold text-foreground/80"
							>ยอดจองเป้าหมาย</Table.Head
						>
						<Table.Head class="px-3 py-4 text-center text-xs font-bold text-foreground/80"
							>คงเหลือรับได้</Table.Head
						>
						<Table.Head class="min-w-[220px] px-6 py-4 text-xs font-bold text-foreground/80">
							<span
								title="ความคืบหน้าคิดจาก (ยอดจอง + ยอดในคลัง) ÷ เป้าหมาย — เกณฑ์เดียวกับที่ระบบใช้ปิดรับอัตโนมัติ (T-22)"
							>
								ความคืบหน้า
							</span>
						</Table.Head>
						<Table.Head class="px-6 py-4 text-center text-xs font-bold text-foreground/80"
							>สถานะโปรโมตหน้าแรก</Table.Head
						>
						<Table.Head class="px-6 py-4 text-right text-xs font-bold text-foreground/80"
							>การจัดการ</Table.Head
						>
					</Table.Row>
				</Table.Header>
				<Table.Body class="divide-y divide-border/60 text-xs">
					{#if flatRows.length === 0}
						<Table.Row>
							<Table.Cell colspan={8} class="px-6 py-12 text-center text-muted-foreground">
								ไม่พบรายการความต้องการที่ค้นหา
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each pagedRows as row (row.compoundId + row.itemId)}
							<Table.Row
								class="transition-colors hover:bg-muted/10 {row.state !== 'open'
									? 'bg-muted/10 opacity-70'
									: ''}"
							>
								<!-- Item Title & Shelter -->
								<Table.Cell class="min-w-[240px] px-6 py-4">
									<div class="flex items-center gap-2 text-sm font-bold text-foreground">
										{#if row.state === 'reached'}
											<Badge
												variant="outline"
												class="border-success-border bg-success-muted text-3xs font-extrabold text-success-dark"
												>ครบถ้วน</Badge
											>
										{:else if row.state === 'closed'}
											<Badge variant="destructive" class="text-3xs font-extrabold">CUT-OFF</Badge>
										{/if}
										{row.title}
									</div>
									{#if row.description}
										<p
											class="mt-1 line-clamp-2 text-2xs break-words text-muted-foreground"
											title={row.description}
										>
											{row.description}
										</p>
									{/if}
									{#if row.sharedCampaigns > 1}
										<Badge
											class="mt-1.5 h-auto bg-blue-50 py-0.5 text-2xs font-bold whitespace-normal text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
											title="หน้าบริจาคสาธารณะรวมทุกประกาศที่ขอสิ่งของเดียวกันเป็นการ์ดใบเดียว"
										>
											รวมกับอีก {row.sharedCampaigns - 1} ประกาศบนหน้า public · รวม {formatQty(
												row.publicTotal
											)}
											{formatUnit(row.unit, units, langState.current)}
										</Badge>
									{/if}
								</Table.Cell>

								<!-- Reserved Pledged -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									<Badge variant="secondary" class="px-2.5 text-xs">
										{formatQty(row.reserved || '0')}
										{formatUnit(row.unit, units, langState.current)}
									</Badge>
								</Table.Cell>

								<!-- On-hand -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									<Badge variant="secondary" class="px-2.5 text-xs">
										{formatQty(row.onHand || '0')}
										{formatUnit(row.unit, units, langState.current)}
									</Badge>
								</Table.Cell>

								<!-- Target -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									{formatQty(row.target || '0')}
									<span class="ml-1 text-2xs font-medium text-muted-foreground"
										>{formatUnit(row.unit, units, langState.current)}</span
									>
								</Table.Cell>

								<!-- Remaining: what donors can still book -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									{formatQty(row.remaining || '0')}
									<span class="ml-1 text-2xs font-medium text-muted-foreground"
										>{formatUnit(row.unit, units, langState.current)}</span
									>
								</Table.Cell>

								<!-- Progress -->
								<Table.Cell class="min-w-[220px] px-6 py-4">
									<div class="flex items-center gap-3">
										<div class="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
											<div
												class="h-full rounded-full transition-all duration-300 {row.state ===
												'reached'
													? 'bg-success'
													: row.state === 'closed'
														? 'bg-rose-500'
														: 'bg-primary'}"
												style="width: {row.progressPercent}%"
											></div>
										</div>
										<span class="w-10 text-right text-2xs font-bold text-foreground/80">
											{row.progressPercent}%
										</span>
									</div>
								</Table.Cell>

								<!-- Show on home -->
								<Table.Cell class="px-6 py-4 text-center">
									<Button
										variant="outline"
										type="button"
										onclick={() => onToggleShowOnHome(row.compoundId)}
										disabled={row.state !== 'open'}
										class="h-8 rounded-xl px-3 text-xs font-bold
										{row.showOnHome && row.state === 'open'
											? 'border-blue-200 bg-blue-50/80 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-400'
											: 'border-transparent bg-muted text-muted-foreground opacity-60'}"
									>
										{row.showOnHome && row.state === 'open'
											? 'กำลังโชว์บนหน้าเว็บ'
											: 'ซ่อนจากหน้าเว็บ'}
									</Button>
								</Table.Cell>

								<!-- Actions -->
								<Table.Cell class="px-6 py-4 text-right">
									<div class="flex items-center justify-end gap-2">
										{#if onEdit && row.itemId}
											<Button
												variant="outline"
												type="button"
												onclick={() => onEdit(row.originalItem, row.itemId)}
												class="h-8 gap-1 rounded-xl border-blue-200 bg-blue-50/70 px-2.5 text-xs font-bold text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-400"
											>
												<SlidersHorizontal class="h-3 w-3" />
												แก้ไข
											</Button>
										{/if}

										{#if row.itemId}
											{#if row.state === 'reached'}
												<Button
													variant="outline"
													type="button"
													disabled
													class="h-8 rounded-xl border-muted bg-muted/50 px-2.5 text-xs font-bold text-muted-foreground"
												>
													ปิดอัตโนมัติ (ครบเป้า)
												</Button>
											{:else if row.state === 'open' || row.isManualClosed}
												<Button
													variant="outline"
													type="button"
													onclick={() => onToggleCutOff(row.compoundId, row.itemId)}
													class="h-8 rounded-xl px-2.5 text-xs font-bold
													{row.isManualClosed
														? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400'
														: 'border-rose-200 bg-rose-50/80 text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400'}"
												>
													{row.isManualClosed ? 'เปิดรับบริจาค (Restore)' : 'Force Cut-off'}
												</Button>
											{/if}
										{/if}
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					{/if}
				</Table.Body>
			</Table.Root>
		</div>

		{#if flatRows.length > PAGE_SIZE}
			<div
				class="flex flex-col items-center justify-between gap-3 border-t border-border/60 p-4 sm:flex-row"
			>
				<p class="text-2xs text-muted-foreground">
					แสดง {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, flatRows.length)}
					จาก {flatRows.length} รายการ
				</p>
				<PaginationControls
					bind:page={() => safePage, (p) => (currentPage = p)}
					count={flatRows.length}
					perPage={PAGE_SIZE}
				/>
			</div>
		{/if}
	</div>
</div>
