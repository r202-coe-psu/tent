<script lang="ts">
	import { STAFF_SYSTEM_OVERVIEW_I18N } from '$lib/constants/i18n/staff-system-overview';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
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
		useOverviewDemographics
	} from '../application/queries';
	import OverviewFilterBar from './overview-filter-bar.svelte';
	import OverviewSiteKindStrip from './overview-site-kind-strip.svelte';
	import OverviewPhaseStrip from './overview-phase-strip.svelte';
	import OverviewOriginSection from './overview-origin-section.svelte';
	import OverviewDemographicsSection from './overview-demographics-section.svelte';
	import OverviewSitesSection from './overview-sites-section.svelte';

	const t = $derived(getTranslation(STAFF_SYSTEM_OVERVIEW_I18N, langState.current));

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

	const isError = $derived(
		summaryQuery.isError || sitesQuery.isError || originQuery.isError || demographicsQuery.isError
	);
</script>

<StaffPageShell title={t.pageTitle} description={t.pageDescription}>
	<OverviewFilterBar {filters} onChange={(next) => (filters = next)} showSearch={false} />

	{#if isError}
		<Alert variant="destructive">
			<AlertCircle class="h-4 w-4" />
			<AlertTitle>{t.errorTitle}</AlertTitle>
			<AlertDescription>{t.errorBody}</AlertDescription>
		</Alert>
	{/if}

	<OverviewSiteKindStrip summary={summaryQuery.data} loading={summaryQuery.isPending} />

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

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<OverviewOriginSection buckets={originQuery.data?.buckets} loading={originQuery.isPending} />
		<OverviewDemographicsSection
			age_groups={demographicsQuery.data?.age_groups}
			countries={demographicsQuery.data?.countries}
			age_by_country={demographicsQuery.data?.age_by_country}
			loading={demographicsQuery.isPending}
		/>
	</div>
</StaffPageShell>
