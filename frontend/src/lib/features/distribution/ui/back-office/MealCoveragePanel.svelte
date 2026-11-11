<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Loader from '@lucide/svelte/icons/loader';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { useEvacuees, useMovements, zoneLabel } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { useDistributionLogsWithSkipped } from '../../application/queries';
	import {
		MIN_MEALS_PER_DAY,
		summarizeMealCoverage
	} from '../../domain/food-supplies/meal-coverage';
	import {
		ALL_ZONES,
		attachZones,
		coverageCounts,
		coverageResidents,
		coverageZones,
		filterCoverageRows,
		pageSlice,
		previousThaiDay,
		sortCoverageRows,
		type CoverageFilter
	} from '../model/meal-coverage-view';
	import MealCoverageBadges from './MealCoverageBadges.svelte';
	import MealCoverageFilters from './MealCoverageFilters.svelte';

	interface Props {
		shelterCode?: string;
	}

	let { shelterCode }: Props = $props();

	const PAGE_SIZE = 20;

	// Today is excluded on purpose: its meals are not over yet, so everyone would look short.
	const latestDay = previousThaiDay();
	let day = $state(latestDay);
	let filter = $state<CoverageFilter>('all');
	let query = $state('');
	let zone = $state(ALL_ZONES);
	let pickedPage = $state(1);

	const evacueesQuery = useEvacuees();
	const movementsQuery = useMovements();
	const logsQuery = useDistributionLogsWithSkipped(() => shelterCode);
	// Only for zone names: while it loads or if it fails, zoneLabel falls back to the zone code.
	const shelterQuery = useShelter(() => shelterCode ?? '');
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	const isLoading = $derived(
		evacueesQuery.isLoading || movementsQuery.isLoading || logsQuery.isLoading
	);
	const isError = $derived(evacueesQuery.isError || movementsQuery.isError || logsQuery.isError);
	const skippedCount = $derived(logsQuery.data?.skipped.length ?? 0);

	// A cleared or typed-in date can be empty, today or in the future: show a prompt, never a
	// list, since presence and meals are only meaningful for a finished day.
	const dayIsValid = $derived(/^\d{4}-\d{2}-\d{2}$/.test(day) && day <= latestDay);
	const residents = $derived(
		dayIsValid
			? coverageResidents({
					day,
					evacuees: evacueesQuery.data ?? [],
					movements: movementsQuery.data ?? []
				})
			: []
	);
	const presentCount = $derived(residents.filter((r) => r.presentAllDay).length);
	const allRows = $derived(
		attachZones(
			summarizeMealCoverage({ day, residents, logs: logsQuery.data?.items ?? [] }),
			residents
		)
	);
	const counts = $derived(coverageCounts(allRows));
	const rows = $derived(sortCoverageRows(filterCoverageRows(allRows, { filter, query, zone })));
	const zoneOptions = $derived(
		coverageZones(allRows).map((code) => ({ value: code, label: zoneLabel(code, shelterZones) }))
	);
	const paged = $derived(pageSlice(rows, pickedPage, PAGE_SIZE));

	const cards = $derived([
		{
			id: 'all',
			label: 'อยู่ในศูนย์ตลอดวัน',
			value: presentCount,
			hint: `ยังไม่ครบ ${counts.all} คน`,
			icon: Users,
			border: 'border-slate-200/80',
			active: 'border-slate-500 bg-slate-50',
			iconClass: 'text-slate-500'
		},
		{
			id: 'none',
			label: 'ยังไม่มีบันทึกเลย',
			value: counts.none,
			hint: 'ยังไม่มีบันทึกรับอาหารสักมื้อ',
			icon: CircleAlert,
			border: 'border-red-200',
			active: 'border-red-500 bg-red-50',
			iconClass: 'text-red-600'
		},
		{
			id: 'partial',
			label: 'มีบันทึก 1 มื้อ',
			value: counts.partial,
			hint: `ยังไม่ถึง ${MIN_MEALS_PER_DAY} มื้อ`,
			icon: TriangleAlert,
			border: 'border-amber-200',
			active: 'border-amber-500 bg-amber-50',
			iconClass: 'text-amber-600'
		}
	] as const satisfies readonly object[]);

	function selectFilter(next: CoverageFilter) {
		filter = next;
		pickedPage = 1;
	}
	function clearFilters() {
		filter = 'all';
		query = '';
		zone = ALL_ZONES;
		pickedPage = 1;
	}
</script>

<section class="space-y-4" aria-labelledby="meal-coverage-title">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<h3 id="meal-coverage-title" class="text-lg font-bold text-slate-900 sm:text-xl">
				ผู้พักพิงที่ยังไม่มีบันทึกรับอาหารครบ {MIN_MEALS_PER_DAY} มื้อ
			</h3>
			<p class="text-sm text-slate-500">
				นับมื้อเช้า กลางวัน เย็น จากบันทึกการแจกของผู้ที่อยู่ในศูนย์ตลอดทั้งวัน
				มื้อที่แจกโดยไม่สแกนจะไม่ถูกนับ
			</p>
		</div>
		<div class="space-y-1.5">
			<Label for="meal-coverage-day" class="text-sm font-semibold text-slate-700">วันที่</Label>
			<Input
				id="meal-coverage-day"
				type="date"
				bind:value={
					() => day,
					(v) => {
						day = v;
						pickedPage = 1;
					}
				}
				max={latestDay}
				class="h-11 w-44 bg-white sm:h-10"
			/>
		</div>
	</div>

	{#if skippedCount > 0}
		<div
			class="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50 p-3 text-sm text-amber-900"
			role="alert"
		>
			<AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			มีบันทึกการแจก {skippedCount} รายการที่อ่านไม่ได้ จำนวนมื้ออาจต่ำกว่าความจริง
		</div>
	{/if}

	{#if !dayIsValid}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			เลือกวันที่ที่ผ่านมาแล้ว (ไม่เกินเมื่อวาน)
		</div>
	{:else if isLoading}
		<div class="flex items-center gap-2 p-6 text-sm text-slate-500">
			<Loader class="size-4 animate-spin" aria-hidden="true" /> กำลังโหลด…
		</div>
	{:else if isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง
		</div>
	{:else if presentCount === 0}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันนี้
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			{#each cards as card (card.id)}
				{@const isActive = filter === card.id}
				<button
					type="button"
					aria-pressed={isActive}
					onclick={() => selectFilter(card.id)}
					class="min-h-11 cursor-pointer rounded-xl border p-4 text-left shadow-2xs transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2 focus-visible:outline-none {isActive
						? `${card.active} ring-1 ring-slate-300`
						: `${card.border} bg-white`}"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="text-sm font-semibold text-slate-700">{card.label}</span>
						<card.icon class="size-5 {card.iconClass}" aria-hidden="true" />
					</div>
					<div class="mt-2 text-3xl font-bold text-slate-900 tabular-nums">{card.value}</div>
					<p class="mt-0.5 text-sm text-slate-500">{card.hint}</p>
				</button>
			{/each}
		</div>

		{#if allRows.length === 0}
			<div
				class="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-900"
			>
				<CircleCheck class="size-4 shrink-0" aria-hidden="true" />
				ทุกคนที่อยู่ในศูนย์ตลอดวันมีบันทึกรับอาหารอย่างน้อย {MIN_MEALS_PER_DAY} มื้อ
			</div>
		{:else}
			<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
				<MealCoverageFilters
					{query}
					{filter}
					{zone}
					zones={zoneOptions}
					shown={rows.length}
					total={allRows.length}
					onQueryChange={(v) => {
						query = v;
						pickedPage = 1;
					}}
					onFilterChange={selectFilter}
					onZoneChange={(v) => {
						zone = v;
						pickedPage = 1;
					}}
				/>
				{#if rows.length === 0}
					<div class="flex flex-col items-center gap-3 p-10 text-center">
						<p class="text-sm font-semibold text-slate-900">ไม่พบรายชื่อที่ตรงกับเงื่อนไข</p>
						<Button variant="outline" class="h-11 sm:h-10" onclick={clearFilters}
							>ล้างตัวกรอง</Button
						>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<Table.Root class="w-full text-left text-sm text-slate-700">
							<Table.Header class="border-b border-slate-200 bg-slate-50/75 text-xs text-slate-600">
								<Table.Row>
									<Table.Head scope="col" class="px-4 py-3 font-semibold">ชื่อ</Table.Head>
									<Table.Head scope="col" class="px-3 py-3 font-semibold">โซนปัจจุบัน</Table.Head>
									<Table.Head scope="col" class="px-3 py-3 font-semibold">มื้ออาหาร</Table.Head>
									<Table.Head scope="col" class="px-3 py-3 font-semibold">สถานะ</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body class="divide-y divide-slate-100">
								{#each paged.items as row (row.id)}
									<Table.Row class="hover:bg-slate-50/80">
										<Table.Cell class="px-4 py-3 font-medium text-slate-900">{row.name}</Table.Cell>
										<Table.Cell class="px-3 py-3 text-slate-600"
											>{zoneLabel(row.zone, shelterZones)}</Table.Cell
										>
										<Table.Cell class="px-3 py-3">
											<MealCoverageBadges received={row.received} />
										</Table.Cell>
										<Table.Cell class="px-3 py-3 whitespace-nowrap">
											{#if row.received.length === 0}
												<span
													class="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800"
												>
													<CircleAlert class="size-3.5" aria-hidden="true" />
													ยังไม่มีบันทึก
												</span>
											{:else}
												<span
													class="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
												>
													<TriangleAlert class="size-3.5" aria-hidden="true" />
													มีบันทึก 1 มื้อ
												</span>
											{/if}
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
					<div
						class="flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row"
					>
						<p class="text-sm text-slate-500">
							แสดง <span class="font-semibold text-slate-800 tabular-nums"
								>{paged.start}–{paged.end}</span
							>
							จาก <span class="font-semibold text-slate-800 tabular-nums">{rows.length}</span> คน
						</p>
						<PaginationControls
							bind:page={() => paged.page, (next) => (pickedPage = next)}
							count={rows.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</section>
