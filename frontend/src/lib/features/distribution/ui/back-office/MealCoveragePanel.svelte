<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import Loader from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { useMealServiceReceipts, useMealServices } from '$lib/features/kitchen';
	import { useEvacuees, useMovements, zoneLabel } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { downloadCsv } from '$lib/utils/download-csv';
	import { useDistributionLogsByDay } from '../../application/queries';
	import {
		COVERAGE_MEALS,
		coverageThreshold,
		summarizeMealCoverage,
		unscannedMeals
	} from '../../domain/food-supplies/meal-coverage';
	import { coverageCsvFilename, coverageRowsToCsv, mealList } from '../model/meal-coverage-csv';
	import { servedMealsOfDay } from '../model/meal-coverage-served';
	import {
		ALL_ZONES,
		attachHouseholdRecorded,
		attachZones,
		coverageCounts,
		coverageDayMode,
		coverageResidents,
		coverageZones,
		filterCoverageRows,
		pageSlice,
		previousThaiDay,
		sortCoverageRows,
		thaiToday,
		type CoverageFilter
	} from '../model/meal-coverage-view';
	import MealCoverageAdvisories from './MealCoverageAdvisories.svelte';
	import MealCoverageFilters from './MealCoverageFilters.svelte';
	import MealCoverageKpiCards from './MealCoverageKpiCards.svelte';
	import MealCoverageTable from './MealCoverageTable.svelte';

	interface Props {
		shelterCode?: string;
	}

	let { shelterCode }: Props = $props();

	const PAGE_SIZE = 20;

	// Fixed when the tab opens: a day change at midnight needs a reopen, like the rest of this page.
	const today = thaiToday();
	let day = $state(previousThaiDay());
	let filter = $state<CoverageFilter>('all');
	let query = $state('');
	let zone = $state(ALL_ZONES);
	let pickedPage = $state(1);

	// A cleared or typed-in date can be empty or in the future: show a prompt, never a list.
	const mode = $derived(coverageDayMode(day, today));

	const evacueesQuery = useEvacuees();
	const movementsQuery = useMovements();
	const logsQuery = useDistributionLogsByDay(
		() => shelterCode,
		() => day,
		() => mode.kind !== 'invalid'
	);
	const servicesQuery = useMealServices();
	const receiptsQuery = useMealServiceReceipts();
	// Only for zone names: while it loads or if it fails, zoneLabel falls back to the zone code.
	const shelterQuery = useShelter(() => shelterCode ?? '');
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	// Meal services only matter while the day is running; a finished day counts every main meal.
	const needsServices = $derived(mode.kind === 'today');
	const isLoading = $derived(
		evacueesQuery.isLoading ||
			movementsQuery.isLoading ||
			logsQuery.isLoading ||
			(needsServices && (servicesQuery.isLoading || receiptsQuery.isLoading))
	);
	const isError = $derived(
		evacueesQuery.isError ||
			movementsQuery.isError ||
			logsQuery.isError ||
			(needsServices && (servicesQuery.isError || receiptsQuery.isError))
	);
	const skippedCount = $derived(logsQuery.data?.skipped.length ?? 0);

	const servedMeals = $derived(
		mode.kind === 'today'
			? servedMealsOfDay(day, servicesQuery.data ?? [], receiptsQuery.data ?? [])
			: COVERAGE_MEALS
	);
	const threshold = $derived(coverageThreshold(servedMeals));
	const logs = $derived(logsQuery.data?.items ?? []);

	const residents = $derived(
		mode.kind === 'invalid'
			? []
			: coverageResidents({
					day,
					evacuees: evacueesQuery.data ?? [],
					movements: movementsQuery.data ?? []
				})
	);
	const presentCount = $derived(residents.filter((r) => r.presentAllDay).length);
	const allRows = $derived(
		attachHouseholdRecorded(
			attachZones(summarizeMealCoverage({ day, residents, logs, servedMeals }), residents),
			residents,
			logs,
			day
		)
	);
	const unscanned = $derived(
		presentCount > 0 && threshold > 0 ? unscannedMeals({ day, logs, servedMeals }) : []
	);
	const counts = $derived(coverageCounts(allRows));
	const showPartial = $derived(threshold >= 2);
	const activeFilter = $derived(filter === 'partial' && !showPartial ? 'all' : filter);
	const rows = $derived(
		sortCoverageRows(filterCoverageRows(allRows, { filter: activeFilter, query, zone }))
	);
	const zoneName = (code: string | null) => (code ? zoneLabel(code, shelterZones) : '');
	const zoneOptions = $derived(
		coverageZones(allRows).map((code) => ({ value: code, label: zoneLabel(code, shelterZones) }))
	);
	const paged = $derived(pageSlice(rows, pickedPage, PAGE_SIZE));

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
	function exportCsv() {
		downloadCsv(
			coverageCsvFilename(shelterCode ?? 'shelter', day),
			coverageRowsToCsv(rows, zoneName)
		);
		toast.success('ส่งออกรายการแล้ว');
	}
</script>

<section class="space-y-4" aria-labelledby="meal-coverage-title">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div class="space-y-1">
			<h3 id="meal-coverage-title" class="text-lg font-bold text-slate-900 sm:text-xl">
				{threshold >= 2
					? `ผู้พักพิงที่ยังไม่มีบันทึกรับอาหารครบ ${threshold} มื้อ`
					: 'ผู้พักพิงที่ยังไม่มีบันทึกรับอาหารของมื้อที่ให้บริการแล้ว'}
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
				max={today}
				class="h-11 w-44 bg-white sm:h-10"
			/>
		</div>
	</div>

	{#if mode.kind === 'today' && !isLoading && !isError}
		<p class="flex items-start gap-2 text-sm text-slate-600">
			<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{#if servedMeals.length > 0}
				วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว: {mealList(servedMeals)}
			{:else}
				วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว
			{/if}
		</p>
	{/if}

	<MealCoverageAdvisories {skippedCount} unscannedMeals={isLoading || isError ? [] : unscanned} />

	{#if mode.kind === 'invalid'}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			เลือกวันที่ (ไม่เกินวันนี้)
		</div>
	{:else if isLoading}
		<div class="flex items-center gap-2 p-6 text-sm text-slate-500">
			<Loader class="size-4 animate-spin" aria-hidden="true" /> กำลังโหลด…
		</div>
	{:else if isError}
		<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง
		</div>
	{:else if mode.kind === 'today' && servedMeals.length === 0}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			ยังไม่มีมื้อที่ให้บริการวันนี้
		</div>
	{:else if presentCount === 0}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			{mode.kind === 'today'
				? 'ไม่มีผู้ที่อยู่ในศูนย์ตั้งแต่ 00:00 ถึงตอนนี้'
				: 'ไม่มีผู้ที่อยู่ในศูนย์ตลอดทั้งวันนี้'}
		</div>
	{:else}
		<MealCoverageKpiCards
			filter={activeFilter}
			{presentCount}
			{counts}
			{threshold}
			onSelect={selectFilter}
		/>

		{#if allRows.length === 0}
			<div
				class="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-900"
			>
				<CircleCheck class="size-4 shrink-0" aria-hidden="true" />
				ทุกคนที่อยู่ในศูนย์ตลอดวันมีบันทึกรับอาหารอย่างน้อย {threshold} มื้อ
			</div>
		{:else}
			<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
				<MealCoverageFilters
					{query}
					filter={activeFilter}
					{zone}
					zones={zoneOptions}
					shown={rows.length}
					total={allRows.length}
					{showPartial}
					onExport={exportCsv}
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
					<MealCoverageTable
						{paged}
						total={rows.length}
						pageSize={PAGE_SIZE}
						{servedMeals}
						{zoneName}
						onPageChange={(next) => (pickedPage = next)}
					/>
				{/if}
			</div>
		{/if}
	{/if}
</section>
