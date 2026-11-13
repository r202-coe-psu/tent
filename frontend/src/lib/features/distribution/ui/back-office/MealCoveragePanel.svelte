<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Users from '@lucide/svelte/icons/users';
	import Utensils from '@lucide/svelte/icons/utensils';
	import { toast } from 'svelte-sonner';
	import { Alert, AlertDescription } from '$lib/components/ui/alert/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import { Label } from '$lib/components/ui/label/index.js';
	import { useMealServiceReceipts, useMealServices } from '$lib/features/kitchen';
	import { useEvacuees, useMovements, zoneLabel } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { downloadCsv } from '$lib/utils/download-csv';
	import { useDistributionLogsByDay } from '../../application/queries';
	import {
		COVERAGE_MEALS,
		coverageThreshold,
		MIN_MEALS_PER_DAY,
		distributedPortionsByMeal,
		portionsByDistributor,
		hasPartialStatus,
		mealCoverageRoster,
		mealCoverageShares,
		unscannedMeals
	} from '../../domain/food-supplies/meal-coverage';
	import { coverageCsvFilename, coverageRowsToCsv, mealList } from '../model/meal-coverage-csv';
	import { preparedPortionsOfDay, servedMealsOfDay } from '../model/meal-coverage-served';
	import {
		ALL_ZONES,
		attachHouseholdRecorded,
		attachZones,
		coverageByZone,
		coverageCounts,
		coverageDayMode,
		coverageResidents,
		coverageZones,
		filterCoverageRows,
		pageSlice,
		sortCoverageRows,
		thaiToday,
		type CoverageFilter
	} from '../model/meal-coverage-view';
	import MealCoverageAdvisories from './MealCoverageAdvisories.svelte';
	import MealCoverageDistributorCard from './MealCoverageDistributorCard.svelte';
	import MealCoverageFilters from './MealCoverageFilters.svelte';
	import MealCoverageGaugeCard from './MealCoverageGaugeCard.svelte';
	import MealCoverageKpiCards from './MealCoverageKpiCards.svelte';
	import MealCoverageRatioCard, { type RatioRow } from './MealCoverageRatioCard.svelte';
	import MealCoverageTable from './MealCoverageTable.svelte';
	import MealCoverageZoneCard from './MealCoverageZoneCard.svelte';

	interface Props {
		shelterCode?: string;
		/** When set, each name opens that person's record (the host page decides where). */
		onOpenPerson?: (id: string) => void;
	}

	let { shelterCode, onOpenPerson }: Props = $props();

	const PAGE_SIZE = 20;

	// Fixed when the tab opens: a day change at midnight needs a reopen, like the rest of this page.
	const today = thaiToday();
	let day = $state(today);
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
			attachZones(mealCoverageRoster({ day, residents, logs, servedMeals }), residents),
			residents,
			logs,
			day
		)
	);
	const shares = $derived(mealCoverageShares({ day, residents, logs, servedMeals }));
	// Prepared portions are context, not a gate: until the kitchen data is in, there is no total.
	const kitchenReady = $derived(
		!servicesQuery.isLoading &&
			!servicesQuery.isError &&
			!receiptsQuery.isLoading &&
			!receiptsQuery.isError
	);
	const portionRows = $derived.by<RatioRow[]>(() => {
		const distributed = distributedPortionsByMeal(logs, day);
		const prepared = kitchenReady
			? preparedPortionsOfDay(day, servicesQuery.data ?? [], receiptsQuery.data ?? [])
			: null;
		return COVERAGE_MEALS.map((meal) => ({
			meal,
			done: distributed[meal],
			total: prepared?.[meal] ?? null,
			pending: !servedMeals.includes(meal)
		}));
	});
	const peopleRows = $derived<RatioRow[]>(
		shares.meals.map((m) => ({
			meal: m.meal,
			done: m.recorded,
			total: shares.present,
			pending: !m.served
		}))
	);
	const unscanned = $derived(
		presentCount > 0 && threshold > 0 ? unscannedMeals({ day, logs, servedMeals }) : []
	);
	const counts = $derived(coverageCounts(allRows));
	const zoneCoverage = $derived(coverageByZone(allRows));
	const distributors = $derived(portionsByDistributor(logs, day));
	const showPartial = $derived(hasPartialStatus(threshold));
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
			coverageRowsToCsv(rows, zoneName, threshold)
		);
		toast.success('ส่งออกรายการแล้ว');
	}
</script>

<section class="space-y-4" aria-labelledby="meal-coverage-title">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
		<div class="min-w-0 space-y-1">
			<h3 id="meal-coverage-title" class="text-lg font-bold text-slate-900 sm:text-xl">
				การรับอาหารประจำวัน
			</h3>
			<p class="text-sm text-slate-500">
				อาหารที่แจกและผู้ที่มีบันทึกรับของวันที่เลือก มื้อที่แจกโดยไม่สแกนจะไม่ถูกนับ
			</p>
		</div>
		<div class="space-y-1.5">
			<Label for="meal-coverage-day" class="text-sm font-semibold text-slate-700">วันที่</Label>
			<DatePicker
				id="meal-coverage-day"
				bind:value={
					() => day,
					(v) => {
						day = v;
						pickedPage = 1;
					}
				}
				max={today}
				format={formatThaiShortDate}
				class="w-full bg-white sm:!h-10 sm:w-44"
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

	<MealCoverageAdvisories {skippedCount} unscanned={isLoading || isError ? [] : unscanned} />

	{#if mode.kind === 'invalid'}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			เลือกวันที่ (ไม่เกินวันนี้)
		</div>
	{:else if isLoading}
		<div class="space-y-4" role="status" aria-label="กำลังโหลด">
			<Skeleton class="h-48 w-full rounded-xl" />
			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Skeleton class="h-80 w-full rounded-xl" />
				<Skeleton class="h-80 w-full rounded-xl" />
			</div>
			<Skeleton class="h-64 w-full rounded-xl" />
		</div>
	{:else if isError}
		<Alert variant="destructive" class="border-red-200 bg-red-50">
			<CircleAlert aria-hidden="true" />
			<AlertDescription>โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง</AlertDescription>
		</Alert>
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
			{counts}
			{threshold}
			isToday={mode.kind === 'today'}
			onSelect={selectFilter}
		/>

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
			<MealCoverageGaugeCard
				present={counts.all}
				complete={counts.complete}
				partial={counts.partial}
				none={counts.none}
				{threshold}
				{showPartial}
			/>
			<MealCoverageZoneCard zones={zoneCoverage} {zoneName} />
			<div class="lg:col-span-2 xl:col-span-1">
				<MealCoverageDistributorCard {distributors} />
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<MealCoverageRatioCard
				title="อาหารที่แจกแล้ว"
				description="จำนวนชุดที่มีบันทึกแจก เทียบกับที่ครัวทำได้"
				unit="ชุด"
				totalLabel="ครัวทำได้"
				doneLabel="แจกแล้ว"
				icon={Utensils}
				accent="#0284C7"
				rows={portionRows}
			/>
			<MealCoverageRatioCard
				title="ผู้ที่มีบันทึกรับอาหาร"
				description="จากผู้ที่อยู่ในศูนย์ {shares.present} คน"
				unit="คน"
				totalLabel="อยู่ในศูนย์"
				doneLabel="มีบันทึกรับ"
				icon={Users}
				accent="#16A34A"
				rows={peopleRows}
				summary={{ label: `ครบ ${threshold} มื้อ`, done: shares.complete, total: shares.present }}
			/>
		</div>

		<div class="space-y-1 pt-2">
			<h4 class="text-base font-bold text-slate-900 sm:text-lg">
				รายชื่อผู้พักพิงและบันทึกรับอาหาร
			</h4>
			<p class="text-sm text-slate-500">
				นับมื้อเช้า กลางวัน เย็น ของผู้ที่อยู่ในศูนย์{mode.kind === 'today'
					? 'ตั้งแต่ต้นวันถึงตอนนี้'
					: 'ตลอดทั้งวัน'}
			</p>
		</div>

		{#if counts.incomplete > 0}
			<Alert
				class="items-center rounded-xl border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 *:[svg]:row-span-1 *:[svg]:translate-y-0"
			>
				<TriangleAlert class="text-amber-600" aria-hidden="true" />
				<AlertDescription
					class="flex flex-col gap-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between"
				>
					<span class="space-y-1">
						<span class="block">
							<span class="font-bold tabular-nums">{counts.incomplete} คน</span>
							ยังไม่ถึง {threshold} มื้อ จากผู้ที่อยู่ในศูนย์ {counts.all} คน
						</span>
						{#if mode.kind === 'today' && !showPartial}
							<span class="block text-xs text-amber-900/80">
								วันนี้นับเฉพาะมื้อที่ให้บริการแล้ว ({servedMeals.length} มื้อ) ดูเกณฑ์ครบ {MIN_MEALS_PER_DAY}
								มื้อได้ที่วันที่ผ่านมา
							</span>
						{/if}
					</span>
					<Button
						variant="outline"
						class="h-11 w-full shrink-0 bg-white sm:h-10 sm:w-auto"
						aria-pressed={activeFilter === 'incomplete'}
						onclick={() => selectFilter(activeFilter === 'incomplete' ? 'all' : 'incomplete')}
					>
						{activeFilter === 'incomplete' ? 'ดูทุกคน' : 'ดูเฉพาะรายชื่อนี้'}
					</Button>
				</AlertDescription>
			</Alert>
		{/if}

		{#if counts.complete === counts.all}
			<div
				class="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-900"
			>
				<CircleCheck class="size-4 shrink-0" aria-hidden="true" />
				ทุกคนที่อยู่ในศูนย์{mode.kind === 'today'
					? 'ตั้งแต่ต้นวัน'
					: 'ตลอดวัน'}มีบันทึกรับอาหารอย่างน้อย {threshold} มื้อ
			</div>
		{/if}

		<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
			<MealCoverageFilters
				{query}
				filter={activeFilter}
				{zone}
				zones={zoneOptions}
				shown={rows.length}
				total={allRows.length}
				{showPartial}
				{threshold}
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
					<Button variant="outline" class="h-11 sm:h-10" onclick={clearFilters}>ล้างตัวกรอง</Button>
				</div>
			{:else}
				<MealCoverageTable
					{paged}
					total={rows.length}
					pageSize={PAGE_SIZE}
					{servedMeals}
					{threshold}
					{zoneName}
					{onOpenPerson}
					onPageChange={(next) => (pickedPage = next)}
				/>
			{/if}
		</div>
	{/if}
</section>
