<script lang="ts">
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { NeedItem } from '$lib/features/operations';
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

	// Flatten rows for individual needs display
	type FlatNeedRow = {
		compoundId: string;
		itemId: string;
		title: string;
		location: string;
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
	};

	const flatRows = $derived.by(() => {
		const rows: FlatNeedRow[] = [];
		for (const item of items) {
			if (!item.needs || item.needs.length === 0) {
				rows.push({
					compoundId: item.id,
					itemId: '',
					title: item.title,
					location: item.location,
					name: item.title,
					unit: 'ชิ้น',
					reserved: '0',
					onHand: '0',
					target: '0',
					progressPercent: 0,
					showOnHome: item.showOnHome,
					isCutOff: item.isCutOff,
					isManualClosed: item.isManualClosed,
					originalItem: item
				});
			} else {
				for (const need of item.needs) {
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
						name: need.name,
						unit: need.unit || 'ชิ้น',
						reserved: need.reserved,
						onHand: need.onHand,
						target: need.target,
						progressPercent: progress,
						showOnHome: item.showOnHome,
						isCutOff: need.isCutOff,
						isManualClosed: need.isManualClosed,
						originalItem: item
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
				<button
					type="button"
					onclick={onAddRequest}
					class="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#002D5B] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
				>
					<Plus class="h-4 w-4" />
					สร้างประกาศแบบกำหนดเอง (Special Request)
				</button>
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
					<select
						bind:value={statusFilter}
						class="h-9 rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
					>
						<option value="all">สถานะ: ทั้งหมด</option>
						<option value="showing">สถานะ: กำลังโชว์บนหน้าเว็บ</option>
						<option value="hidden">สถานะ: ซ่อนจากหน้าเว็บ</option>
						<option value="cutoff">สถานะ: Force Cut-off</option>
					</select>

					<select
						bind:value={sortOrder}
						class="h-9 rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
					>
						<option value="progress_asc">เรียง: ความคืบหน้าน้อยไปมาก</option>
						<option value="progress_desc">เรียง: ความคืบหน้ามากไปน้อย</option>
						<option value="name">เรียง: ชื่อ ก-ฮ</option>
					</select>
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
						<Table.Head class="px-6 py-4 text-center text-xs font-bold text-foreground/80"
							>ยอดจองบริจาคแล้ว</Table.Head
						>
						<Table.Head class="px-6 py-4 text-center text-xs font-bold text-foreground/80"
							>ยอดจองเป้าหมาย</Table.Head
						>
						<Table.Head class="px-6 py-4 text-xs font-bold text-foreground/80"
							>ความคืบหน้า (PROGRESS)</Table.Head
						>
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
							<Table.Cell colspan={6} class="px-6 py-12 text-center text-muted-foreground">
								ไม่พบรายการความต้องการที่ค้นหา
							</Table.Cell>
						</Table.Row>
					{:else}
						{#each flatRows as row (row.compoundId + row.itemId)}
							<Table.Row
								class="transition-colors hover:bg-muted/10 {row.isCutOff
									? 'bg-muted/10 opacity-70'
									: ''}"
							>
								<!-- Item Title & Shelter -->
								<Table.Cell class="min-w-[240px] px-6 py-4">
									<div class="flex items-center gap-2 text-sm font-bold text-foreground">
										{#if row.isCutOff}
											<span
												class="rounded-md bg-rose-100 px-1.5 py-0.5 text-3xs font-extrabold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400"
											>
												CUT-OFF
											</span>
										{/if}
										{row.title}
									</div>
									<div class="mt-1 text-2xs text-muted-foreground">{row.location}</div>
								</Table.Cell>

								<!-- Reserved Pledged -->
								<Table.Cell class="px-6 py-4 text-center font-bold text-foreground">
									<span class="inline-block rounded-md bg-muted/60 px-2.5 py-1 text-xs">
										{roundQty(row.reserved || '0')}
									</span>
								</Table.Cell>

								<!-- Target -->
								<Table.Cell class="px-6 py-4 text-center font-bold text-foreground">
									{roundQty(row.target || '0')}
									<span class="ml-1 text-2xs font-medium text-muted-foreground">{row.unit}</span>
								</Table.Cell>

								<!-- Progress -->
								<Table.Cell class="min-w-[180px] px-6 py-4">
									<div class="flex items-center gap-3">
										<div class="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
											<div
												class="h-full rounded-full transition-all duration-300 {row.isCutOff
													? 'bg-rose-500'
													: 'bg-primary'}"
												style="width: {row.progressPercent}%"
											></div>
										</div>
										<span class="w-9 text-right text-2xs font-semibold text-muted-foreground">
											{row.progressPercent}%
										</span>
									</div>
								</Table.Cell>

								<!-- Show on home -->
								<Table.Cell class="px-6 py-4 text-center">
									<button
										type="button"
										onclick={() => onToggleShowOnHome(row.compoundId)}
										disabled={row.originalItem.isCutOff}
										class="inline-flex cursor-pointer items-center justify-center rounded-xl border px-3 py-1.5 text-xs font-bold transition-all
										{row.showOnHome && !row.originalItem.isCutOff
											? 'border-blue-200 bg-blue-50/80 text-blue-600 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-400'
											: 'cursor-not-allowed border-transparent bg-muted text-muted-foreground opacity-60'}"
									>
										{row.showOnHome && !row.originalItem.isCutOff
											? 'กำลังโชว์บนหน้าเว็บ'
											: 'ซ่อนจากหน้าเว็บ'}
									</button>
								</Table.Cell>

								<!-- Actions -->
								<Table.Cell class="px-6 py-4 text-right">
									<div class="flex items-center justify-end gap-2">
										<!-- Edit Button -->
										{#if onEdit && row.itemId}
											<button
												type="button"
												onclick={() => onEdit(row.originalItem, row.itemId)}
												class="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-blue-200 bg-blue-50/70 px-2.5 py-1.5 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-400"
											>
												<SlidersHorizontal class="h-3 w-3" />
												แก้ไข
											</button>
										{/if}

										<!-- Force Cut-off. A need that filled up on its own is already
										     closed by the derived rule (T-22) — forcing it by hand would
										     write a manual close plus an audit reason for nothing. -->
										{#if row.itemId}
											{#if row.isCutOff && !row.isManualClosed}
												<button
													type="button"
													disabled
													class="inline-flex cursor-not-allowed items-center justify-center rounded-xl border border-muted bg-muted/50 px-2.5 py-1.5 text-xs font-bold text-muted-foreground opacity-70"
												>
													ปิดอัตโนมัติ (ครบเป้า)
												</button>
											{:else}
												<button
													type="button"
													onclick={() => onToggleCutOff(row.compoundId, row.itemId)}
													class="inline-flex cursor-pointer items-center justify-center rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors
													{row.isManualClosed
														? 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-400'
														: 'border-rose-200 bg-rose-50/80 text-rose-600 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400'}"
												>
													{row.isManualClosed ? 'เปิดรับบริจาค (Restore)' : 'Force Cut-off'}
												</button>
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
	</div>
</div>
