<script lang="ts">
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { parseCampaignNotes, publicItemAggregate, type NeedItem } from '$lib/features/operations';
	import { addQty, parseQty, qtyIsZero, roundQty } from '$lib/utils/qty';

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

	let searchQuery = $state('');
	let statusFilter = $state('all');
	let sortOrder = $state<'progress_asc' | 'progress_desc' | 'name'>('progress_asc');

	const STATUS_OPTIONS = [
		{ value: 'all', label: 'สถานะ: ทั้งหมด' },
		{ value: 'showing', label: 'สถานะ: กำลังโชว์บนหน้าเว็บ' },
		{ value: 'hidden', label: 'สถานะ: ซ่อนจากหน้าเว็บ' },
		{ value: 'cutoff', label: 'สถานะ: Force Cut-off' }
	];
	const SORT_OPTIONS = [
		{ value: 'progress_asc', label: 'เรียง: ความคืบหน้าน้อยไปมาก' },
		{ value: 'progress_desc', label: 'เรียง: ความคืบหน้ามากไปน้อย' },
		{ value: 'name', label: 'เรียง: ชื่อ ก-ฮ' }
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
		progressPercent: number;
		showOnHome: boolean;
		isCutOff: boolean;
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
					unit: 'ชิ้น',
					reserved: '0',
					onHand: '0',
					target: '0',
					progressPercent: 0,
					showOnHome: item.showOnHome,
					isCutOff: item.isCutOff,
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
						unit: need.unit || 'ชิ้น',
						reserved: need.reserved,
						onHand: need.onHand,
						target: need.target,
						progressPercent: progress,
						showOnHome: item.showOnHome,
						isCutOff: need.isCutOff,
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

			if (statusFilter === 'showing') return r.showOnHome && !r.isCutOff;
			if (statusFilter === 'hidden') return !r.showOnHome || r.isCutOff;
			if (statusFilter === 'cutoff') return r.isCutOff;
			return true;
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
		<!-- Top Section Header -->
		<div
			class="flex flex-col justify-between gap-4 border-b border-border/60 bg-muted/5 p-6 lg:flex-row lg:items-center"
		>
			<div>
				<h2 class="flex items-center gap-2.5 text-base font-bold text-foreground">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
					>
						<Megaphone class="h-5 w-5" />
					</div>
					จัดการกระดานแจ้งความต้องการด่วน (Public Needs Board)
				</h2>
				<p class="mt-1 text-2xs text-muted-foreground">
					สับสวิตช์เปิด-ปิด
					หรือจำกัดจำนวนรายการสิ่งของที่ศูนย์ต้องการแจ้งให้สาธารณชนรับทราบผ่านทางหน้าเว็บแรก
				</p>
			</div>

			<!-- Right Status & Action Box -->
			<div
				class="flex flex-col items-start gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end"
			>
				<!-- Special Request Button -->
				<Button
					type="button"
					onclick={onAddRequest}
					class="h-10 gap-2 rounded-xl bg-[#002D5B] px-5 text-xs font-bold text-white shadow-xs hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
				>
					<Plus class="h-4 w-4" />
					สร้างประกาศแบบกำหนดเอง (Special Request)
				</Button>
			</div>
		</div>

		<!-- Filter Bar -->
		<div class="border-b border-border/60 bg-card p-4">
			<div class="flex flex-col gap-3 md:flex-row md:items-center">
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
				<div class="flex flex-wrap items-center gap-2">
					<Select.Root type="single" bind:value={statusFilter}>
						<Select.Trigger
							aria-label="กรองตามสถานะ"
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

					<Select.Root type="single" bind:value={sortOrder}>
						<Select.Trigger
							aria-label="เรียงลำดับ"
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

		<!-- Table -->
		<div class="overflow-x-auto">
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
							<Table.Cell colspan={7} class="px-6 py-12 text-center text-muted-foreground">
								ไม่พบรายการความต้องการที่ค้นหา
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each pagedRows as row (row.compoundId + row.itemId)}
							<Table.Row
								class="transition-colors hover:bg-muted/10 {row.isCutOff
									? 'bg-muted/10 opacity-70'
									: ''}"
							>
								<!-- Item Title & Shelter -->
								<Table.Cell class="min-w-[240px] px-6 py-4">
									<div class="flex items-center gap-2 text-sm font-bold text-foreground">
										{#if row.isCutOff}
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
											รวมกับอีก {row.sharedCampaigns - 1} ประกาศบนหน้า public · รวม {roundQty(
												row.publicTotal
											)}
											{row.unit}
										</Badge>
									{/if}
								</Table.Cell>

								<!-- Reserved Pledged -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									<Badge variant="secondary" class="px-2.5 text-xs">
										{roundQty(row.reserved || '0')}
									</Badge>
								</Table.Cell>

								<!-- On-hand. Shown because the progress bar and the automatic
								     cut-off both count it: a need can close with almost no
								     bookings if the warehouse already holds the goods, and staff
								     had no way to see that from this table. -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									<Badge variant="secondary" class="px-2.5 text-xs">
										{roundQty(row.onHand || '0')}
									</Badge>
								</Table.Cell>

								<!-- Target -->
								<Table.Cell class="px-3 py-4 text-center font-bold text-foreground">
									{roundQty(row.target || '0')}
									<span class="ml-1 text-2xs font-medium text-muted-foreground">{row.unit}</span>
								</Table.Cell>

								<!-- Progress -->
								<Table.Cell class="min-w-[220px] px-6 py-4">
									<div class="flex items-center gap-3">
										<div class="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
											<div
												class="h-full rounded-full transition-all duration-300 {row.isCutOff
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
										disabled={row.originalItem.isCutOff}
										class="h-8 rounded-xl px-3 text-xs font-bold
										{row.showOnHome && !row.originalItem.isCutOff
											? 'border-blue-200 bg-blue-50/80 text-blue-600 hover:bg-blue-100 hover:text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-400'
											: 'border-transparent bg-muted text-muted-foreground opacity-60'}"
									>
										{row.showOnHome && !row.originalItem.isCutOff
											? 'กำลังโชว์บนหน้าเว็บ'
											: 'ซ่อนจากหน้าเว็บ'}
									</Button>
								</Table.Cell>

								<!-- Actions -->
								<Table.Cell class="px-6 py-4 text-right">
									<div class="flex items-center justify-end gap-2">
										<!-- Edit Button -->
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

										<!-- Force Cut-off. A need that filled up on its own is already
										     closed by the derived rule (T-22) — forcing it by hand would
										     write a manual close plus an audit reason for nothing. -->
										{#if row.itemId}
											{#if row.isCutOff && !row.isManualClosed}
												<Button
													variant="outline"
													type="button"
													disabled
													class="h-8 rounded-xl border-muted bg-muted/50 px-2.5 text-xs font-bold text-muted-foreground"
												>
													ปิดอัตโนมัติ (ครบเป้า)
												</Button>
											{:else}
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
				<Pagination.Root bind:page={currentPage} count={flatRows.length} perPage={PAGE_SIZE}>
					{#snippet children({ pages })}
						<Pagination.Content>
							<Pagination.Previous />
							{#each pages as p, i (p.type === 'page' ? `page-${p.value}` : `ellipsis-${i}`)}
								<Pagination.Item>
									{#if p.type === 'page'}
										<Pagination.Link page={p} isActive={p.value === safePage} />
									{:else}
										<Pagination.Ellipsis />
									{/if}
								</Pagination.Item>
							{/each}
							<Pagination.Next />
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			</div>
		{/if}
	</div>
</div>
