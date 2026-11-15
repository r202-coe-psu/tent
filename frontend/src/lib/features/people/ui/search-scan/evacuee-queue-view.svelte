<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack, type Snippet } from 'svelte';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Eye from '@lucide/svelte/icons/eye';
	import Globe from '@lucide/svelte/icons/globe';
	import Home from '@lucide/svelte/icons/home';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import Zap from '@lucide/svelte/icons/zap';

	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { paginateItems } from '$lib/db/paginate';
	import { getShelterCode } from '$lib/db/shelter';
	import { useMasterData, formatMasterLabel } from '$lib/features/master-data';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { formatDisplayDateTime } from '$lib/utils/date';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	import { useEvacuees, useHouseholds, useScreenings } from '../../application/queries';
	import {
		formatPersonName,
		maskNationalId,
		matchesEvacueeSearch,
		zoneLabel
	} from '../../domain/people';
	import {
		isInShelterStatus,
		nextQueueLabel,
		nextQueueLabelText
	} from '../../domain/intake-pipeline';
	import { peopleLabels } from '../../domain/people';
	import { EVACUEE_QUEUE_I18N } from '../_constants/evacuee-queue.i18n';
	import type { Evacuee } from '../../domain/people';
	import RegisteredViaBadge from '../shared/registered-via-badge.svelte';
	import StayStatusBadge from '../shared/stay-status-badge.svelte';

	const t = $derived(getTranslation(EVACUEE_QUEUE_I18N, langState.current));
	const stayStatusLabels = $derived(peopleLabels(langState.current).stayStatus);

	const PAGE_SIZE = 10;
	/** Status filter value for the 「พักในศูนย์แล้ว」 KPI card (active + room_confirmed). */
	const IN_SHELTER_FILTER = 'in_shelter';

	type WorkflowTab = 'pre_registered' | 'arriving' | 'all';
	type ArrivingSubTab = 'all' | 'medical' | 'zoning';
	type PreRegChannelFilter = 'all' | 'kiosk' | 'web' | 'other';

	let {
		enableMedical = false,
		canMedical = false,
		canZoning = false,
		/** Free-text filter applied to every tab (bound to the intake omnibox on Station 1). */
		filterQuery = '',
		/** Initial workflow tab; Station 1 keeps `pre_registered`, search-edit uses `all`. */
		initialTab = 'pre_registered',
		onOpenRow,
		onReportIn,
		onProfile,
		onGoMedical,
		onGoZoning
	}: {
		enableMedical?: boolean;
		canMedical?: boolean;
		canZoning?: boolean;
		filterQuery?: string;
		initialTab?: WorkflowTab;
		onOpenRow: (evacuee: Evacuee) => void;
		onReportIn: (evacuee: Evacuee) => void;
		onProfile: (evacuee: Evacuee) => void;
		onGoMedical?: (evacuee: Evacuee) => void;
		onGoZoning?: (evacuee: Evacuee) => void;
	} = $props();

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenings = $derived(screeningsQuery.data ?? []);
	const screenedIds = $derived(new Set(screenings.map((s) => s.evacuee_id)));
	const screeningByEvacuee = $derived(new Map(screenings.map((s) => [s.evacuee_id, s])));

	let activeTab = $state<WorkflowTab>(untrack(() => initialTab));
	let arrivingSubTab = $state<ArrivingSubTab>('all');
	let preRegChannelFilter = $state<PreRegChannelFilter>('all');
	let allStatusFilter = $state<string>('all');
	let allZoneFilter = $state<string>('all');
	let currentPage = $state(1);

	// Summary KPI counts
	const preRegisteredEvacuees = $derived(
		allEvacuees.filter(
			(e) =>
				e.current_stay?.status === 'pre_registered' || e.current_stay?.status === 'kiosk_registered'
		)
	);
	const arrivingEvacuees = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'arriving')
	);
	const inShelterEvacuees = $derived(allEvacuees.filter(isInShelterStatus));
	const roomConfirmedCount = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'room_confirmed').length
	);
	const waitingMedicalCount = $derived(
		arrivingEvacuees.filter((e) => enableMedical && !screenedIds.has(e._id)).length
	);
	const waitingZoningCount = $derived(
		arrivingEvacuees.filter((e) => !enableMedical || screenedIds.has(e._id)).length
	);

	// Pre-registered channel counts
	const kioskPreRegCount = $derived(
		preRegisteredEvacuees.filter((e) => e.registered_via === 'kiosk' || !!e.card_snapshot).length
	);
	const webPreRegCount = $derived(
		preRegisteredEvacuees.filter((e) => e.registered_via === 'web').length
	);
	const otherPreRegCount = $derived(
		preRegisteredEvacuees.filter(
			(e) => e.registered_via !== 'kiosk' && !e.card_snapshot && e.registered_via !== 'web'
		).length
	);

	const preRegisteredFiltered = $derived(
		preRegisteredEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, filterQuery)) return false;
				const isKiosk = e.registered_via === 'kiosk' || !!e.card_snapshot;
				const isWeb = e.registered_via === 'web';
				if (preRegChannelFilter === 'kiosk') return isKiosk;
				if (preRegChannelFilter === 'web') return isWeb;
				if (preRegChannelFilter === 'other') return !isKiosk && !isWeb;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const arrivingFiltered = $derived(
		arrivingEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, filterQuery)) return false;
				const hasScreening = screenedIds.has(e._id);
				if (arrivingSubTab === 'medical') return enableMedical && !hasScreening;
				if (arrivingSubTab === 'zoning') return !enableMedical || hasScreening;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const allFiltered = $derived(
		allEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, filterQuery)) return false;
				if (allStatusFilter === IN_SHELTER_FILTER) {
					if (!isInShelterStatus(e)) return false;
				} else if (allStatusFilter !== 'all' && e.current_stay?.status !== allStatusFilter) {
					return false;
				}
				if (allZoneFilter !== 'all' && e.current_stay?.zone !== allZoneFilter) return false;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const activeFiltered = $derived(
		activeTab === 'pre_registered'
			? preRegisteredFiltered
			: activeTab === 'arriving'
				? arrivingFiltered
				: allFiltered
	);

	// Hybrid: full `useEvacuees()` for KPI/tab filters; client `paginateItems` for the table.
	// Back-office `listEvacueesPaginated` uses limited Couch `_all_docs` when unfiltered.
	const pagedRows = $derived(paginateItems(activeFiltered, currentPage, PAGE_SIZE));

	$effect(() => {
		void [
			activeTab,
			arrivingSubTab,
			preRegChannelFilter,
			allStatusFilter,
			allZoneFilter,
			filterQuery
		];
		currentPage = 1;
	});

	const availableZones = $derived(
		Array.from(new Set(allEvacuees.map((e) => e.current_stay?.zone).filter(Boolean))) as string[]
	);

	function specialNeedsShort(needs: string[]): string {
		if (!needs?.length) return '—';
		return needs
			.slice(0, 2)
			.map((n) => {
				const item = vulnerableGroupQuery.data?.items.find((i) => i.code === n);
				return item ? formatMasterLabel(item, langState.current) : n;
			})
			.join(', ');
	}

	function formatUpdated(iso?: string | null): string {
		if (!iso) return '—';
		return formatDisplayDateTime(iso, langState.current) || iso;
	}

	function zoneText(row: Evacuee): string {
		return row.current_stay?.zone
			? t.zoneName(zoneLabel(row.current_stay.zone, shelterZones))
			: '—';
	}

	function householdLabel(row: Evacuee): string {
		return (row.household_id ? householdMap.get(row.household_id)?.label : null) ?? '—';
	}

	function nextQueueFor(row: Evacuee) {
		return nextQueueLabel(row, {
			enableMedicalScreening: enableMedical,
			hasScreening: screenedIds.has(row._id)
		});
	}

	function nextQueueBadgeVariant(
		next: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (next === 'รอแพทย์') return 'destructive';
		if (next === 'รอโซน') return 'default';
		if (next === 'รอยืนยันถึงโซน') return 'default';
		if (next === 'พักแล้ว') return 'secondary';
		return 'outline';
	}
</script>

<!-- Row pieces shared by the desktop table cells and the mobile cards (below md). -->
{#snippet profileButton(row: Evacuee, card: boolean)}
	<Button
		size="sm"
		variant="outline"
		class="gap-1.5 rounded-lg border-slate-200 px-3 font-semibold text-slate-700 {card
			? 'min-h-11 w-full'
			: ''}"
		onclick={(e) => {
			e.stopPropagation();
			onProfile(row);
		}}
	>
		<Eye class="size-3.5" />
		<span>{t.viewProfile}</span>
	</Button>
{/snippet}

{#snippet reportInButton(row: Evacuee, card: boolean)}
	<Button
		size="sm"
		class="gap-1.5 rounded-lg bg-blue-600 px-3 font-semibold text-white shadow-2xs hover:bg-blue-700 {card
			? 'min-h-11 w-full'
			: ''}"
		onclick={(e) => {
			e.stopPropagation();
			onReportIn(row);
		}}
	>
		<Zap class="size-3.5" />
		<span>{t.reportIn}</span>
	</Button>
{/snippet}

{#snippet medicalStatus(row: Evacuee)}
	{@const screening = screeningByEvacuee.get(row._id)}
	{#if screening}
		<span class="inline-flex items-center gap-1 font-medium text-emerald-700">
			<CheckCircle2 class="size-3.5 shrink-0 text-emerald-600" />
			{t.screened}{#if screening.triage_level}
				({t.triage[screening.triage_level] ?? screening.triage_level}){/if}
		</span>
	{:else}
		<span class="font-medium text-amber-700">{t.awaitingScreening}</span>
	{/if}
{/snippet}

{#snippet arrivingNextBadge(row: Evacuee, card: boolean)}
	<Badge
		variant={nextQueueBadgeVariant(nextQueueFor(row))}
		class="font-semibold {card ? 'h-auto whitespace-normal' : ''}"
	>
		{nextQueueLabelText(nextQueueFor(row), langState.current)}
	</Badge>
{/snippet}

{#snippet screeningButton(row: Evacuee, card: boolean)}
	{#if canMedical && nextQueueFor(row) === 'รอแพทย์' && onGoMedical}
		<Button
			size="sm"
			variant="outline"
			class="gap-1 border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 {card
				? 'min-h-11 w-full'
				: ''}"
			onclick={(e) => {
				e.stopPropagation();
				onGoMedical(row);
			}}
		>
			<Stethoscope class="size-3.5" />
			<span>{t.screeningButton}</span>
		</Button>
	{/if}
{/snippet}

{#snippet zoningButton(row: Evacuee, card: boolean)}
	{#if canZoning && (nextQueueFor(row) === 'รอโซน' || !enableMedical || screenedIds.has(row._id)) && onGoZoning}
		<Button
			size="sm"
			class="gap-1 bg-[#0A2647] text-white hover:bg-[#051930] {card ? 'min-h-11 w-full' : ''}"
			onclick={(e) => {
				e.stopPropagation();
				onGoZoning(row);
			}}
		>
			<MapPin class="size-3.5" />
			<span>{t.zoningButton}</span>
		</Button>
	{/if}
{/snippet}

{#snippet allNextBadge(row: Evacuee, card: boolean)}
	<Badge variant="secondary" class="text-xs {card ? 'h-auto whitespace-normal' : ''}">
		{nextQueueLabelText(nextQueueFor(row), langState.current)}
	</Badge>
{/snippet}

{#snippet nameWithNickname(row: Evacuee)}
	{formatPersonName(row)}
	{#if row.nickname}
		<span class="text-xs font-normal text-slate-500">({row.nickname})</span>
	{/if}
{/snippet}

{#snippet cardTitle(row: Evacuee, name: Snippet)}
	<button
		type="button"
		class="min-h-11 w-full min-w-0 text-left text-base font-bold break-words text-slate-900"
		onclick={() => onOpenRow(row)}
	>
		{@render name()}
	</button>
{/snippet}

<!-- Queue Stat Summary Cards -->
<section aria-label={t.summaryAria} class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
	<!-- Card 1: Pre-registered -->
	<button
		type="button"
		onclick={() => (activeTab = 'pre_registered')}
		class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
		'pre_registered'
			? 'border-blue-300 bg-blue-50/50 shadow-2xs ring-2 ring-blue-500/20'
			: 'border-slate-200/80 bg-white shadow-2xs'}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-blue-900">{t.preRegTitle}</span>
			<div
				class="flex size-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 transition-colors group-hover:bg-blue-200"
			>
				<CalendarClock class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
				{preRegisteredEvacuees.length}
				<span class="text-xs font-normal text-slate-500">{t.unitPeople}</span>
			</p>
			<p class="mt-0.5 text-2xs text-slate-500">{t.preRegSub}</p>
		</div>
	</button>

	<!-- Card 2: Arriving -->
	<button
		type="button"
		onclick={() => (activeTab = 'arriving')}
		class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
		'arriving'
			? 'border-amber-300 bg-amber-50/50 shadow-2xs ring-2 ring-amber-500/20'
			: 'border-slate-200/80 bg-white shadow-2xs'}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-amber-900">{t.arrivingTitle}</span>
			<div
				class="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 transition-colors group-hover:bg-amber-200"
			>
				<Clock class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
				{arrivingEvacuees.length}
				<span class="text-xs font-normal text-slate-500">{t.unitPeople}</span>
			</p>
			<p class="mt-0.5 text-2xs text-slate-500">
				{#if enableMedical}
					{t.awaitingDoctor} {waitingMedicalCount} ·
				{/if}{`${t.awaitingZone} ${waitingZoningCount}`}
			</p>
		</div>
	</button>

	<!-- Card 3: In Shelter -->
	<button
		type="button"
		onclick={() => {
			activeTab = 'all';
			allStatusFilter = IN_SHELTER_FILTER;
		}}
		class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'all' && allStatusFilter === IN_SHELTER_FILTER
			? 'border-green-300 bg-green-50/50 shadow-2xs ring-2 ring-green-500/20'
			: 'border-slate-200/80 bg-white shadow-2xs'}"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-green-900">{t.inShelterTitle}</span>
			<div
				class="flex size-7 items-center justify-center rounded-lg bg-green-100 text-green-700 transition-colors group-hover:bg-green-200"
			>
				<Home class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
				{inShelterEvacuees.length}
				<span class="text-xs font-normal text-slate-500">{t.unitPeople}</span>
			</p>
			<p class="mt-0.5 text-2xs text-slate-500">{t.zoneConfirmedCount(roomConfirmedCount)}</p>
		</div>
	</button>

	<!-- Card 4: Central Pool Info -->
	<div
		class="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
	>
		<div class="flex items-center justify-between">
			<span class="text-xs font-semibold text-slate-700">{t.centralPoolTitle}</span>
			<div class="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
				<Globe class="size-4" />
			</div>
		</div>
		<div class="mt-2">
			<p class="text-base font-bold text-slate-800">{t.centralPoolReady}</p>
			<p class="mt-0.5 text-2xs text-slate-500">{t.centralPoolHint}</p>
		</div>
	</div>
</section>

<!-- Workflow Tabs & Lists -->
<section class="flex flex-col gap-4">
	<!-- Tab Switcher Navigation -->
	<div class="border-b border-border">
		<nav class="flex flex-col gap-1 sm:flex-row sm:overflow-x-auto" aria-label={t.tabsAria}>
			<button
				type="button"
				onclick={() => {
					activeTab = 'all';
					allStatusFilter = 'all';
				}}
				class="flex min-h-11 shrink-0 items-center gap-2 border-l-2 px-3 py-2 text-left text-sm font-semibold transition-colors sm:min-h-0 sm:border-b-2 sm:border-l-0 sm:px-4 sm:pt-0 sm:pb-3 {activeTab ===
				'all'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Users class="size-4" />
				<span>{t.tabAll}</span>
				<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
					{allEvacuees.length}
				</span>
			</button>

			<button
				type="button"
				onclick={() => (activeTab = 'pre_registered')}
				class="flex min-h-11 shrink-0 items-center gap-2 border-l-2 px-3 py-2 text-left text-sm font-semibold transition-colors sm:min-h-0 sm:border-b-2 sm:border-l-0 sm:px-4 sm:pt-0 sm:pb-3 {activeTab ===
				'pre_registered'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<CalendarClock class="size-4" />
				<span>{t.tabPreRegistered}</span>
				<span
					class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800 tabular-nums dark:bg-blue-950 dark:text-blue-300"
				>
					{preRegisteredEvacuees.length}
				</span>
			</button>

			<button
				type="button"
				onclick={() => (activeTab = 'arriving')}
				class="flex min-h-11 shrink-0 items-center gap-2 border-l-2 px-3 py-2 text-left text-sm font-semibold transition-colors sm:min-h-0 sm:border-b-2 sm:border-l-0 sm:px-4 sm:pt-0 sm:pb-3 {activeTab ===
				'arriving'
					? 'border-primary text-primary'
					: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
			>
				<Clock class="size-4" />
				<span>{t.tabArriving}</span>
				<span
					class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 tabular-nums dark:bg-amber-950 dark:text-amber-300"
				>
					{arrivingEvacuees.length}
				</span>
			</button>
		</nav>
	</div>

	<!-- Tab 1: All Evacuees (ผู้ประสบภัยทั้งหมด) -->
	{#if activeTab === 'all'}
		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-col gap-3 border-b border-slate-200/80 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex w-full flex-wrap items-center gap-3 sm:w-auto">
					<div class="flex w-full min-w-0 items-center gap-1.5 text-xs text-slate-600 sm:w-auto">
						<span class="font-medium">{t.statusFilter}</span>
						<select
							bind:value={allStatusFilter}
							class="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:ring-1 focus:ring-primary focus:outline-hidden sm:h-8 sm:flex-none"
						>
							<option value="all">{t.allStatuses}</option>
							<option value={IN_SHELTER_FILTER}>{t.inShelterOption}</option>
							<option value="pre_registered">{stayStatusLabels.pre_registered}</option>
							<option value="kiosk_registered">{stayStatusLabels.kiosk_registered}</option>
							<option value="arriving">{stayStatusLabels.arriving}</option>
							<option value="active">{stayStatusLabels.active}</option>
							<option value="room_confirmed">{stayStatusLabels.room_confirmed}</option>
							<option value="temporary_leave">{stayStatusLabels.temporary_leave}</option>
							<option value="transferred">{stayStatusLabels.transferred}</option>
							<option value="checked_out">{stayStatusLabels.checked_out}</option>
							<option value="deceased">{stayStatusLabels.deceased}</option>
							<option value="cancelled">{stayStatusLabels.cancelled}</option>
						</select>
					</div>

					{#if availableZones.length > 0}
						<div class="flex w-full min-w-0 items-center gap-1.5 text-xs text-slate-600 sm:w-auto">
							<span class="font-medium">{t.zoneFilter}</span>
							<select
								bind:value={allZoneFilter}
								class="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:ring-1 focus:ring-primary focus:outline-hidden sm:h-8 sm:flex-none"
							>
								<option value="all">{t.allZones}</option>
								{#each availableZones as z (z)}
									<option value={z}>{t.zoneName(zoneLabel(z, shelterZones))}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
				<span class="text-xs text-slate-500">
					{t.showing(allFiltered.length, allEvacuees.length)}
				</span>
			</div>

			{#if allFiltered.length === 0}
				<div
					class="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500"
				>
					<p class="font-medium text-slate-700">{t.noMatch}</p>
				</div>
			{:else}
				<!-- Mobile card list (< md) -->
				<div class="space-y-3 p-3 md:hidden">
					{#each pagedRows.items as row (row._id)}
						<article
							data-testid="queue-card"
							class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
						>
							{#snippet allName()}{formatPersonName(row)}{/snippet}
							{@render cardTitle(row, allName)}
							<dl class="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
								<dt class="text-slate-500">{t.colStatus}</dt>
								<dd class="min-w-0">
									<StayStatusBadge status={row.current_stay?.status} size="sm" />
								</dd>
								<dt class="text-slate-500">{t.colZone}</dt>
								<dd class="min-w-0 break-words text-slate-700">{zoneText(row)}</dd>
								<dt class="text-slate-500">{t.colFamily}</dt>
								<dd class="min-w-0 break-words text-slate-700">{householdLabel(row)}</dd>
								<dt class="text-slate-500">{t.colSpecialNeeds}</dt>
								<dd class="min-w-0 break-words text-slate-700">
									{specialNeedsShort(row.special_needs)}
								</dd>
								<dt class="text-slate-500">{t.colUpdated}</dt>
								<dd class="min-w-0 break-words text-slate-700 tabular-nums">
									{formatUpdated(row.updated_at)}
								</dd>
								<dt class="text-slate-500">{t.colNextQueue}</dt>
								<dd class="min-w-0">{@render allNextBadge(row, true)}</dd>
							</dl>
							<div class="mt-3 flex flex-col gap-2">
								{@render profileButton(row, true)}
							</div>
						</article>
					{/each}
				</div>

				<!-- Desktop table (md+) -->
				<div class="hidden overflow-x-auto md:block">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 pl-5 text-xs font-semibold text-slate-600"
									>{t.colName}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colStatus}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colZone}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colFamily}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colSpecialNeeds}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colUpdated}</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-xs font-semibold text-slate-600"
									>{t.colNextQueue}</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>{t.colActions}</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row (row._id)}
								<Table.Row
									class="cursor-pointer hover:bg-slate-50/80"
									onclick={() => onOpenRow(row)}
								>
									<Table.Cell class="py-3 pl-5 font-semibold text-slate-900">
										{formatPersonName(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<StayStatusBadge status={row.current_stay?.status} size="sm" />
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs font-medium">
										{zoneText(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-600">
										{householdLabel(row)}
									</Table.Cell>
									<Table.Cell class="max-w-[14rem] truncate px-3 py-3 text-xs text-slate-600">
										{specialNeedsShort(row.special_needs)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-500 tabular-nums">
										{formatUpdated(row.updated_at)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										{@render allNextBadge(row, false)}
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										{@render profileButton(row, false)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={allFiltered.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Tab 2: Pre-registered (รอรายงานตัว) -->
	{:else if activeTab === 'pre_registered'}
		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-col gap-3 border-b border-slate-200/80 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs font-semibold text-slate-700">{t.channelFilter}</span>
					<button
						type="button"
						onclick={() => (preRegChannelFilter = 'all')}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
						'all'
							? 'border-primary bg-primary/10 font-bold text-primary'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						{t.all} ({preRegisteredEvacuees.length})
					</button>
					<button
						type="button"
						onclick={() => (preRegChannelFilter = 'kiosk')}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
						'kiosk'
							? 'border-amber-400 bg-amber-100/90 font-bold text-amber-900 shadow-2xs'
							: 'border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-100/60'}"
					>
						<CreditCard class="size-3.5 text-amber-700" />
						<span>{t.channelKiosk} ({kioskPreRegCount})</span>
					</button>
					<button
						type="button"
						onclick={() => (preRegChannelFilter = 'web')}
						class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
						'web'
							? 'border-sky-400 bg-sky-100/90 font-bold text-sky-900 shadow-2xs'
							: 'border-sky-200 bg-sky-50/60 text-sky-900 hover:bg-sky-100/60'}"
					>
						<Globe class="size-3.5 text-sky-700" />
						<span>{t.channelWeb} ({webPreRegCount})</span>
					</button>
					{#if otherPreRegCount > 0}
						<button
							type="button"
							onclick={() => (preRegChannelFilter = 'other')}
							class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {preRegChannelFilter ===
							'other'
								? 'border-primary bg-primary/10 font-bold text-primary'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
						>
							{t.channelOther} ({otherPreRegCount})
						</button>
					{/if}
				</div>
				<span class="text-xs text-slate-500">
					{t.showing(preRegisteredFiltered.length, preRegisteredEvacuees.length)}
				</span>
			</div>

			{#if allEvacueesQuery.isPending}
				<div class="flex h-40 items-center justify-center text-sm text-slate-500">
					{t.loading}
				</div>
			{:else if preRegisteredFiltered.length === 0}
				<div
					class="flex h-48 flex-col items-center justify-center gap-3 text-center text-sm text-slate-500"
				>
					<p class="font-medium text-slate-700">{t.emptyPreRegistered}</p>
					<p class="text-xs text-slate-500">
						{preRegChannelFilter !== 'all' ? t.emptyFiltered : t.emptyWalkInHint}
					</p>
					<Button
						variant="outline"
						href={resolve('/onsite/people/new')}
						class="gap-1.5 rounded-xl border-slate-200"
					>
						<UserPlus class="size-4" />
						<span>{t.walkInCta}</span>
					</Button>
				</div>
			{:else}
				<!-- Mobile card list (< md) -->
				<div class="space-y-3 p-3 md:hidden">
					{#each pagedRows.items as row (row._id)}
						<article
							data-testid="queue-card"
							class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
						>
							{#snippet preRegName()}{@render nameWithNickname(row)}{/snippet}
							{@render cardTitle(row, preRegName)}
							<dl class="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
								<dt class="text-slate-500">{t.colDocNo}</dt>
								<dd class="min-w-0 font-mono break-words text-slate-700">
									{maskNationalId(row.person_id?.number)}
								</dd>
								<dt class="text-slate-500">{t.colChannel}</dt>
								<dd class="min-w-0">
									<RegisteredViaBadge
										via={row.registered_via}
										hasCardSnapshot={!!row.card_snapshot}
										size="sm"
									/>
								</dd>
								<dt class="text-slate-500">{t.colPhone}</dt>
								<dd class="min-w-0 break-words text-slate-700 tabular-nums">
									{row.phone || '—'}
								</dd>
								<dt class="text-slate-500">{t.colFamily}</dt>
								<dd class="min-w-0 break-words text-slate-700">{householdLabel(row)}</dd>
								<dt class="text-slate-500">{t.colSpecialNeeds}</dt>
								<dd class="min-w-0 break-words text-slate-700">
									{specialNeedsShort(row.special_needs)}
								</dd>
								<dt class="text-slate-500">{t.colStatus}</dt>
								<dd class="min-w-0">
									<StayStatusBadge status={row.current_stay.status} size="sm" />
								</dd>
							</dl>
							<div class="mt-3 flex flex-col gap-2">
								{@render reportInButton(row, true)}
								{@render profileButton(row, true)}
							</div>
						</article>
					{/each}
				</div>

				<!-- Desktop table (md+) -->
				<div class="hidden overflow-x-auto md:block">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 pl-5 text-xs font-semibold text-slate-600"
									>{t.colName}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colDocNo}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colChannel}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colPhone}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colFamily}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colSpecialNeeds}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colStatus}</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>{t.colActions}</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row (row._id)}
								<Table.Row
									class="cursor-pointer hover:bg-slate-50/80"
									onclick={() => onOpenRow(row)}
								>
									<Table.Cell class="py-3 pl-5 font-semibold text-slate-900">
										{@render nameWithNickname(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 font-mono text-xs text-slate-600">
										{maskNationalId(row.person_id?.number)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<RegisteredViaBadge
											via={row.registered_via}
											hasCardSnapshot={!!row.card_snapshot}
											size="sm"
										/>
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-600 tabular-nums">
										{row.phone || '—'}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs font-medium text-slate-700">
										{householdLabel(row)}
									</Table.Cell>
									<Table.Cell class="max-w-[14rem] truncate px-3 py-3 text-xs text-slate-600">
										{specialNeedsShort(row.special_needs)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										<StayStatusBadge status={row.current_stay.status} size="sm" />
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										<div class="flex justify-end gap-1.5">
											{@render profileButton(row, false)}
											{@render reportInButton(row, false)}
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={preRegisteredFiltered.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Tab 3: Arriving (รอส่งต่อเข้าพัก) -->
	{:else if activeTab === 'arriving'}
		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-col gap-3 border-b border-slate-200/80 bg-white px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs font-semibold text-slate-700">{t.stepFilter}</span>
					<button
						type="button"
						onclick={() => (arrivingSubTab = 'all')}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
						'all'
							? 'border-amber-400 bg-amber-50 font-bold text-amber-900'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						{t.all} ({arrivingEvacuees.length})
					</button>
					{#if enableMedical}
						<button
							type="button"
							onclick={() => (arrivingSubTab = 'medical')}
							class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
							'medical'
								? 'border-destructive bg-destructive/10 font-bold text-destructive'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
						>
							{t.awaitingDoctor} ({waitingMedicalCount})
						</button>
					{/if}
					<button
						type="button"
						onclick={() => (arrivingSubTab = 'zoning')}
						class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
						'zoning'
							? 'border-primary bg-primary/10 font-bold text-primary'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>
						{t.awaitingZoneTab} ({waitingZoningCount})
					</button>
				</div>
				<span class="text-xs text-slate-500">
					{t.showing(arrivingFiltered.length, arrivingEvacuees.length)}
				</span>
			</div>

			{#if arrivingFiltered.length === 0}
				<div
					class="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500"
				>
					<p class="font-medium text-slate-700">{t.emptyCategory}</p>
					<p class="text-xs text-slate-500">{t.allSettled}</p>
				</div>
			{:else}
				<!-- Mobile card list (< md) -->
				<div class="space-y-3 p-3 md:hidden">
					{#each pagedRows.items as row (row._id)}
						<article
							data-testid="queue-card"
							class="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
						>
							{#snippet arrivingName()}{formatPersonName(row)}{/snippet}
							{@render cardTitle(row, arrivingName)}
							<dl class="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
								<dt class="text-slate-500">{t.colDocNo}</dt>
								<dd class="min-w-0 font-mono break-words text-slate-700">
									{maskNationalId(row.person_id?.number)}
								</dd>
								<dt class="text-slate-500">{t.colFamily}</dt>
								<dd class="min-w-0 break-words text-slate-700">{householdLabel(row)}</dd>
								{#if enableMedical}
									<dt class="text-slate-500">{t.colMedical}</dt>
									<dd class="min-w-0 break-words">{@render medicalStatus(row)}</dd>
								{/if}
								<dt class="text-slate-500">{t.colNextQueue}</dt>
								<dd class="min-w-0">{@render arrivingNextBadge(row, true)}</dd>
							</dl>
							<div class="mt-3 flex flex-col gap-2">
								{@render screeningButton(row, true)}
								{@render zoningButton(row, true)}
								{@render profileButton(row, true)}
							</div>
						</article>
					{/each}
				</div>

				<!-- Desktop table (md+) -->
				<div class="hidden overflow-x-auto md:block">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 pl-5 text-xs font-semibold text-slate-600"
									>{t.colName}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colDocNo}</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colFamily}</Table.Head
								>
								{#if enableMedical}
									<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
										>{t.colMedical}</Table.Head
									>
								{/if}
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>{t.colNextQueue}</Table.Head
								>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>{t.colHandoff}</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row (row._id)}
								<Table.Row
									class="cursor-pointer hover:bg-slate-50/80"
									onclick={() => onOpenRow(row)}
								>
									<Table.Cell class="py-3 pl-5 font-semibold text-slate-900">
										{formatPersonName(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 font-mono text-xs text-slate-600">
										{maskNationalId(row.person_id?.number)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-700">
										{householdLabel(row)}
									</Table.Cell>
									{#if enableMedical}
										<Table.Cell class="px-3 py-3 text-xs">
											{@render medicalStatus(row)}
										</Table.Cell>
									{/if}
									<Table.Cell class="px-3 py-3">
										{@render arrivingNextBadge(row, false)}
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										<div class="flex justify-end gap-1.5">
											{@render screeningButton(row, false)}
											{@render zoningButton(row, false)}
											{@render profileButton(row, false)}
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={arrivingFiltered.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</section>
