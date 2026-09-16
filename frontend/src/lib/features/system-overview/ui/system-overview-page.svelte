<script lang="ts">
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import {
		defaultMovementDateRange,
		overviewFiltersSchema,
		type OverviewFilters
	} from '../domain/schemas';
	import {
		useOverviewSummary,
		useOverviewSites,
		useOverviewOrigin,
		useOverviewDemographics,
		usePreRegistrations
	} from '../application/queries';
	import OverviewFilterBar from './overview-filter-bar.svelte';
	import OverviewPhaseStrip from './overview-phase-strip.svelte';
	import OverviewOriginSection from './overview-origin-section.svelte';
	import OverviewDemographicsSection from './overview-demographics-section.svelte';
	import OverviewSitesSection from './overview-sites-section.svelte';
	import OverviewPreregPreview from './overview-prereg-preview.svelte';

	const defaultRange = defaultMovementDateRange();
	let filters = $state<OverviewFilters>(
		overviewFiltersSchema.parse({
			movement_from: defaultRange.from,
			movement_to: defaultRange.to
		})
	);

	const summaryQuery = useOverviewSummary(() => filters);
	const sitesQuery = useOverviewSites(() => filters);
	const originQuery = useOverviewOrigin(() => filters);
	const demographicsQuery = useOverviewDemographics(() => filters);
	const preRegsQuery = usePreRegistrations(() => ({ ...filters, limit: 8, offset: 0 }));

	const isError = $derived(
		summaryQuery.isError ||
			sitesQuery.isError ||
			originQuery.isError ||
			demographicsQuery.isError ||
			preRegsQuery.isError
	);
</script>

<div class="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold tracking-tight text-[#0A2647] sm:text-3xl">ภาพรวมระบบ</h1>
		<p class="text-base text-slate-600">
			สรุปสถานะศูนย์ คิวลงทะเบียนล่วงหน้า และการเคลื่อนย้ายทั่วระบบ
		</p>
	</header>

	<OverviewFilterBar {filters} onChange={(next) => (filters = next)} />

	{#if isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>เกิดข้อผิดพลาด</AlertTitle>
			<AlertDescription>ไม่สามารถโหลดข้อมูลภาพรวมได้ กรุณาลองใหม่อีกครั้ง</AlertDescription>
		</Alert>
	{/if}

	<OverviewPhaseStrip summary={summaryQuery.data} loading={summaryQuery.isPending} />

	<OverviewSitesSection
		sites={sitesQuery.data?.sites}
		loading={sitesQuery.isPending}
		movementFrom={filters.movement_from ?? defaultRange.from}
		movementTo={filters.movement_to ?? defaultRange.to}
		onMovementRangeChange={(next) => {
			filters = { ...filters, ...next };
		}}
	/>

	<div class="grid gap-6 lg:grid-cols-2">
		<OverviewOriginSection buckets={originQuery.data?.buckets} loading={originQuery.isPending} />
		<OverviewDemographicsSection
			age_groups={demographicsQuery.data?.age_groups}
			countries={demographicsQuery.data?.countries}
			age_by_country={demographicsQuery.data?.age_by_country}
			loading={demographicsQuery.isPending}
		/>
	</div>

	<OverviewPreregPreview
		items={preRegsQuery.data?.items}
		total={preRegsQuery.data?.total}
		loading={preRegsQuery.isPending}
	/>
</div>
