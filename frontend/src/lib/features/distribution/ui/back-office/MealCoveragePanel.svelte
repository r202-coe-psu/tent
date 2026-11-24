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
	import { useMealServiceReceipts, useMealServices } from '$lib/features/kitchen';
	import { useEvacuees, useMovements, zoneLabel } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { downloadCsv } from '$lib/utils/download-csv';
	import { useDistributionLogsByRange } from '../../application/queries';
	import {
		COVERAGE_MEALS,
		MIN_MEALS_PER_DAY,
		distributedPortionsByMeal,
		portionsByDistributor,
		dailyMealTrend,
		mealCoverageRoster,
		mealCoverageShares,
		otherRecipientsByMeal,
		unscannedMeals
	} from '../../domain/food-supplies/meal-coverage';
	import { coverageCsvFilename, coverageRowsToCsv } from '../model/meal-coverage-csv';
	import { coverageDays, preparedPortionsOfDay } from '../model/meal-coverage-served';
	import {
		ALL_ZONES,
		attachHouseholdRecorded,
		attachZones,
		coverageByZone,
		coverageCounts,
		coverageEmptyReasons,
		coverageTodayNote,
		coverageRangeFor,
		coverageRangeLabel,
		coverageRangeMode,
		coverageResidents,
		coverageZones,
		filterCoverageRows,
		pageSlice,
		sortCoverageRows,
		thaiToday,
		type CoverageFilter,
		type CoverageRangePreset
	} from '../model/meal-coverage-view';
	import MealCoverageAdvisories from './MealCoverageAdvisories.svelte';
	import MealCoverageDistributorCard from './MealCoverageDistributorCard.svelte';
	import MealCoverageFilters from './MealCoverageFilters.svelte';
	import MealCoverageGaugeCard from './MealCoverageGaugeCard.svelte';
	import MealCoverageKpiCards from './MealCoverageKpiCards.svelte';
	import MealCoverageOtherRecipientsCard from './MealCoverageOtherRecipientsCard.svelte';
	import MealCoverageRangePicker from './MealCoverageRangePicker.svelte';
	import MealCoverageRatioCard, { type RatioRow } from './MealCoverageRatioCard.svelte';
	import MealCoverageTable from './MealCoverageTable.svelte';
	import MealCoverageTrendCard from './MealCoverageTrendCard.svelte';
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
	let preset = $state<CoverageRangePreset>('today');
	let customRange = $state<{ from: string; to: string } | undefined>();
	let filter = $state<CoverageFilter>('all');
	let query = $state('');
	let zone = $state(ALL_ZONES);
	let pickedPage = $state(1);

	// An unpicked custom range can be missing or reversed: show a prompt, never a list.
	const requested = $derived(coverageRangeFor(preset, today, customRange));
	const mode = $derived(
		requested
			? coverageRangeMode(requested.from, requested.to, today)
			: ({ kind: 'invalid' } as const)
	);
	const range = $derived(mode.kind === 'valid' ? mode : null);
	const single = $derived(range?.single ?? true);
	const multiDay = $derived(!single);
	const includesToday = $derived(range?.includesToday ?? false);

	const evacueesQuery = useEvacuees();
	const movementsQuery = useMovements();
	const logsQuery = useDistributionLogsByRange(
		() => shelterCode,
		() => range?.from ?? today,
		() => range?.to ?? today,
		() => range !== null
	);
	const servicesQuery = useMealServices();
	const receiptsQuery = useMealServiceReceipts();
	// Only for zone names: while it loads or if it fails, zoneLabel falls back to the zone code.
	const shelterQuery = useShelter(() => shelterCode ?? '');
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	// Meal services only matter while today is in the range; a finished day counts every main meal.
	const needsServices = $derived(includesToday);
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

	const dayList = $derived(range?.days ?? []);
	const days = $derived(
		coverageDays({
			days: dayList,
			today,
			services: servicesQuery.data ?? [],
			receipts: receiptsQuery.data ?? []
		})
	);
	// The pass mark is 2 meals on every day, today included. Served meals only decide which meals
	// are listed as missing and how the kitchen numbers read: unserved meals are not "missing" yet.
	const servedMeals = $derived(days.at(-1)?.servedMeals ?? COVERAGE_MEALS);
	const todayServed = $derived(days.find((d) => d.day === today)?.servedMeals ?? COVERAGE_MEALS);
	const logs = $derived(logsQuery.data?.items ?? []);
	const logRange = $derived({ from: range?.from ?? today, to: range?.to ?? today });

	const residents = $derived(
		coverageResidents({
			days: dayList,
			evacuees: evacueesQuery.data ?? [],
			movements: movementsQuery.data ?? []
		})
	);
	const allRows = $derived.by(() => {
		const listed = attachZones(mealCoverageRoster({ days, residents, logs }), residents);
		return single && range
			? attachHouseholdRecorded(listed, residents, logs, range.from)
			: listed.map((r) => ({ ...r, householdRecorded: [] }));
	});
	const shares = $derived(mealCoverageShares({ days, residents, logs }));
	// Prepared portions are context, not a gate: until the kitchen data is in, there is no total.
	const kitchenReady = $derived(
		!servicesQuery.isLoading &&
			!servicesQuery.isError &&
			!receiptsQuery.isLoading &&
			!receiptsQuery.isError
	);
	const portionRows = $derived.by<RatioRow[]>(() => {
		const distributed = distributedPortionsByMeal(logs, logRange);
		const prepared = kitchenReady
			? preparedPortionsOfDay(dayList, servicesQuery.data ?? [], receiptsQuery.data ?? [])
			: null;
		return COVERAGE_MEALS.map((meal) => ({
			meal,
			done: distributed[meal],
			total: prepared?.[meal] ?? null,
			pending: single && !servedMeals.includes(meal)
		}));
	});
	const peopleRows = $derived<RatioRow[]>(
		shares.meals.map((m) => ({
			meal: m.meal,
			done: m.recorded,
			total: m.total,
			pending: single && !m.served
		}))
	);
	const unscanned = $derived(unscannedMeals({ days, residents, logs }));
	const otherRecipients = $derived(otherRecipientsByMeal(logs, logRange));
	const trend = $derived(dailyMealTrend(logs, dayList));
	const counts = $derived(coverageCounts(allRows));
	const zoneCoverage = $derived(coverageByZone(allRows));
	const distributors = $derived(portionsByDistributor(logs, logRange));
	const rows = $derived(sortCoverageRows(filterCoverageRows(allRows, { filter, query, zone })));
	const zoneName = (code: string | null) => (code ? zoneLabel(code, shelterZones) : '');
	const zoneOptions = $derived(
		coverageZones(allRows).map((code) => ({ value: code, label: zoneLabel(code, shelterZones) }))
	);
	const paged = $derived(pageSlice(rows, pickedPage, PAGE_SIZE));
	const emptyReasons = $derived(
		coverageEmptyReasons({
			single,
			includesToday,
			judgedPeople: counts.all,
			logCount: logs.length
		})
	);

	// One bar for everything worth knowing before reading the numbers: that today is not over, and
	// why a card is empty.
	const infoMessages = $derived.by(() => {
		const note = includesToday ? coverageTodayNote(todayServed) : null;
		const todayNote = note ? [note] : [];
		return [...todayNote, ...emptyReasons];
	});

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
			coverageCsvFilename(shelterCode ?? 'shelter', logRange.from, logRange.to),
			coverageRowsToCsv(rows, zoneName, multiDay)
		);
		toast.success('ส่งออกรายการแล้ว');
	}
</script>

<section class="space-y-4" aria-labelledby="meal-coverage-title">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
		<div class="min-w-0 space-y-1">
			<h3 id="meal-coverage-title" class="text-lg font-bold text-slate-900 sm:text-xl">
				ภาพรวมการแจกจ่ายอาหาร
			</h3>
			{#if range}
				<p class="text-sm font-semibold text-slate-700 tabular-nums">
					{coverageRangeLabel(range.from, range.to)}
				</p>
			{/if}
			<p class="text-sm text-slate-500">
				นับจากบันทึกการแจกทุกช่องทาง (สแกน QR, ค้นชื่อ, บุคคลภายนอก)
			</p>
		</div>
		<MealCoverageRangePicker
			bind:preset={
				() => preset,
				(v) => {
					preset = v;
					pickedPage = 1;
				}
			}
			bind:customRange={
				() => customRange,
				(v) => {
					customRange = v;
					pickedPage = 1;
				}
			}
			{today}
			current={requested}
		/>
	</div>

	{#if infoMessages.length > 0 && !isLoading && !isError && range}
		<p
			class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
			role="status"
		>
			<Info class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{infoMessages.join(' · ')}
		</p>
	{/if}

	<MealCoverageAdvisories
		{skippedCount}
		unscanned={isLoading || isError ? [] : unscanned}
		{single}
	/>

	{#if !range}
		<div
			class="rounded-xl border border-slate-200/80 bg-white p-6 text-center text-sm text-slate-600"
		>
			เลือกช่วงวันที่ (ไม่เกินวันนี้)
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
	{:else}
		<MealCoverageKpiCards
			{filter}
			{counts}
			partDayOnly={allRows.filter((r) => r.judgedDays === 0).length}
			{multiDay}
			onSelect={selectFilter}
		/>

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
			<MealCoverageGaugeCard
				present={counts.all}
				complete={counts.complete}
				partial={counts.partial}
				none={counts.none}
				{multiDay}
			/>
			<MealCoverageZoneCard zones={zoneCoverage} {zoneName} />
			<div class="lg:col-span-2 xl:col-span-1">
				<MealCoverageDistributorCard {distributors} />
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<MealCoverageRatioCard
				title="อาหารที่แจกแล้ว"
				description={multiDay
					? 'จำนวนชุดที่มีบันทึกแจกในช่วงที่เลือก เทียบกับที่ครัวทำได้'
					: 'จำนวนชุดที่มีบันทึกแจก เทียบกับที่ครัวทำได้'}
				unit="ชุด"
				totalLabel="ครัวทำได้"
				doneLabel="แจกแล้ว"
				icon={Utensils}
				accent="#0284C7"
				rows={portionRows}
				emptyMessage="ไม่มีการแจกจ่ายในช่วงนี้"
			/>
			<MealCoverageRatioCard
				title="ผู้ที่มีบันทึกรับอาหาร"
				description={multiDay
					? `นับเป็นคน-วัน: ผู้ที่อยู่ในศูนย์ตลอดวันในแต่ละวัน รวม ${shares.present} คน-วัน`
					: `จากผู้ที่อยู่ในศูนย์ ${shares.present} คน`}
				unit={multiDay ? 'คน-วัน' : 'คน'}
				totalLabel="อยู่ในศูนย์"
				doneLabel="มีบันทึกรับ"
				icon={Users}
				accent="#16A34A"
				rows={peopleRows}
				summary={{
					label: multiDay ? 'ครบเกณฑ์' : `ครบ ${MIN_MEALS_PER_DAY} มื้อ`,
					done: shares.complete,
					total: shares.present
				}}
				emptyMessage="ไม่มีผู้ที่มีบันทึกรับอาหารในช่วงนี้"
			/>
		</div>

		{#if multiDay}
			<MealCoverageTrendCard {trend} />
		{/if}

		<MealCoverageOtherRecipientsCard meals={otherRecipients} />

		<div class="space-y-1 pt-2">
			<h4 class="text-base font-bold text-slate-900 sm:text-lg">
				รายชื่อผู้พักพิงและบันทึกรับอาหาร
			</h4>
			<p class="text-sm break-words text-slate-500">
				{multiDay
					? 'นับมื้อเช้า กลางวัน เย็น ในช่วงที่เลือก ตัดสินรายวันเฉพาะวันที่อยู่ในศูนย์ทั้งวัน'
					: 'นับมื้อเช้า กลางวัน เย็น ของผู้พักพิงที่อยู่ในศูนย์ทั้งวัน'}
			</p>
			<p class="text-sm break-words text-slate-500">
				{counts.part_day > 0
					? `รายชื่อนับเฉพาะผู้พักพิง รวมผู้ที่อยู่ไม่เต็มวัน ${counts.part_day} คน (ไม่นับเกณฑ์)`
					: 'รายชื่อนับเฉพาะผู้พักพิง'}
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
							{multiDay
								? `รับไม่ครบเกณฑ์อย่างน้อย 1 วัน จากผู้พักพิงในศูนย์ ${counts.all} คน`
								: `รับไม่ครบเกณฑ์ จากผู้พักพิงในศูนย์ ${counts.all} คน`}
						</span>
					</span>
					<Button
						variant="outline"
						class="h-11 w-full shrink-0 bg-white sm:h-10 sm:w-auto"
						aria-pressed={filter === 'incomplete'}
						onclick={() => selectFilter(filter === 'incomplete' ? 'all' : 'incomplete')}
					>
						{filter === 'incomplete' ? 'ดูทุกคน' : 'ดูเฉพาะรายชื่อนี้'}
					</Button>
				</AlertDescription>
			</Alert>
		{/if}

		{#if counts.all > 0 && counts.complete === counts.all}
			<div
				class="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm text-emerald-900"
			>
				<CircleCheck class="size-4 shrink-0" aria-hidden="true" />
				{#if multiDay}
					ทุกคนที่อยู่ในศูนย์ตลอดวันมีบันทึกรับอาหารอย่างน้อย {MIN_MEALS_PER_DAY} มื้อในทุกวัน
				{:else}
					{`ทุกคนที่อยู่ในศูนย์${includesToday ? 'ตั้งแต่ต้นวัน' : 'ตลอดวัน'}มีบันทึกรับอาหารอย่างน้อย ${MIN_MEALS_PER_DAY} มื้อ`}
				{/if}
			</div>
		{/if}

		<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
			<MealCoverageFilters
				{query}
				{filter}
				{zone}
				zones={zoneOptions}
				shown={rows.length}
				total={allRows.length}
				{multiDay}
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
			{#if allRows.length === 0}
				<div class="p-10 text-center">
					<p class="text-sm font-semibold text-slate-900">ไม่มีผู้พักพิงที่อยู่ในศูนย์ในช่วงนี้</p>
				</div>
			{:else if rows.length === 0}
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
					{multiDay}
					{zoneName}
					{onOpenPerson}
					onPageChange={(next) => (pickedPage = next)}
				/>
			{/if}
		</div>
	{/if}
</section>
