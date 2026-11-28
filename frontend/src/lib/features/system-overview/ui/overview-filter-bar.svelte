<script lang="ts">
	import { STAFF_SYSTEM_OVERVIEW_I18N } from '$lib/constants/i18n/staff-system-overview';
	import { getTranslation } from '$lib/utils/i18n';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import HouseholdSearchSelect from '$lib/components/household-search-select.svelte';
	import {
		formatMasterLabel,
		formatMasterLabelByCode,
		useMasterData
	} from '$lib/features/master-data';
	import { langState } from '$lib/states/i18n.svelte';
	import type { OverviewFilters } from '../domain/schemas';

	let {
		filters,
		onChange,
		showHouseholdFilter = false,
		showSearch = true,
		showExternalOption = true,
		showPublicVisibilityFilter = false
	}: {
		filters: OverviewFilters;
		onChange: (next: OverviewFilters) => void;
		showHouseholdFilter?: boolean;
		/** Name / phone search of registrants; the overview page hides it (it only has the list page). */
		showSearch?: boolean;
		/** "External evacuation center" choice in the shelter-type filter; hidden on the pre-registration list. */
		showExternalOption?: boolean;
		/** Only the overview applies it; the pre-registration list does not read it. */
		showPublicVisibilityFilter?: boolean;
	} = $props();

	const t = $derived(getTranslation(STAFF_SYSTEM_OVERVIEW_I18N, langState.current));

	function patch(partial: Partial<OverviewFilters>) {
		onChange({ ...filters, ...partial });
	}

	const EXTERNAL_VALUE = '__external__';
	const siteKindValue = $derived(filters.external ? EXTERNAL_VALUE : (filters.site_kind ?? 'all'));
	const operationStatusValue = $derived(filters.operation_status ?? 'all');
	const stayBucketValue = $derived(filters.stay_bucket ?? 'all');
	const sourceValue = $derived(filters.source ?? 'all');
	const publicVisibilityValue = $derived(filters.public_visibility ?? 'all');
	const householdMode = $derived(filters.shelter_code ? 'shelter' : 'universal');

	// CR-198 FR-10: options are the active kinds; the trigger resolves against every item.
	const siteKindQuery = useMasterData(() => 'site_kind');
	const siteKindItems = $derived(siteKindQuery.data?.items ?? []);
	const siteKindLabel = $derived(
		siteKindValue === 'all'
			? t.all
			: siteKindValue === EXTERNAL_VALUE
				? t.externalBadge
				: formatMasterLabelByCode(siteKindValue, siteKindItems, langState.current)
	);

	const operationStatusLabel = $derived(t.operationStatus[operationStatusValue] ?? t.all);
	const stayBucketLabel = $derived(t.stayBucket[stayBucketValue] ?? t.all);
	const sourceLabel = $derived(t.source[sourceValue] ?? t.all);
	const publicVisibilityLabel = $derived(t.publicVisibility[publicVisibilityValue] ?? t.all);
</script>

<div
	class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs"
>
	<div class="min-w-[9rem] flex-1 basis-[9rem] space-y-1.5">
		<Label for="overview-site-kind" class="text-sm font-semibold text-slate-700"
			>{t.filterSiteKind}</Label
		>
		<Select.Root
			type="single"
			value={siteKindValue}
			onValueChange={(v) => {
				if (!v) return;
				// "External" is its own choice: it clears the kind and sets the external-only filter.
				patch({
					site_kind: v === 'all' || v === EXTERNAL_VALUE ? undefined : v,
					external: v === EXTERNAL_VALUE ? 'only' : undefined
				});
			}}
		>
			<Select.Trigger
				id="overview-site-kind"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label={t.filterSiteKind}
				title={`${t.filterSiteKind}: ${siteKindLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{siteKindLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label={t.all} />
				{#each siteKindItems.filter((i) => i.status === 'active') as item (item.code)}
					<Select.Item value={item.code} label={formatMasterLabel(item, langState.current)} />
				{/each}
				{#if showExternalOption}
					<Select.Item value={EXTERNAL_VALUE} label={t.externalBadge} />
				{/if}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="min-w-[9rem] flex-1 basis-[9rem] space-y-1.5">
		<Label for="overview-op-status" class="text-sm font-semibold text-slate-700"
			>{t.filterOperationStatus}</Label
		>
		<Select.Root
			type="single"
			value={operationStatusValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({
					operation_status: v === 'all' ? undefined : (v as OverviewFilters['operation_status'])
				});
			}}
		>
			<Select.Trigger
				id="overview-op-status"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label={t.filterOperationStatus}
				title={`${t.filterOperationStatus}: ${operationStatusLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{operationStatusLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label={t.all} />
				<Select.Item value="standby" label={t.operationStatus.standby} />
				<Select.Item value="active" label={t.operationStatus.active} />
				<Select.Item value="full_capacity" label={t.operationStatus.full_capacity} />
				<Select.Item value="closed" label={t.operationStatus.closed} />
				<Select.Item value="cancelled" label={t.operationStatus.cancelled} />
				<Select.Item value="unknown" label={t.operationStatus.unknown} />
			</Select.Content>
		</Select.Root>
	</div>

	{#if showPublicVisibilityFilter}
		<div class="min-w-[10.5rem] flex-1 basis-[10.5rem] space-y-1.5">
			<Label for="overview-public-visibility" class="text-sm font-semibold text-slate-700">
				{t.filterPublicVisibility}
			</Label>
			<Select.Root
				type="single"
				value={publicVisibilityValue}
				onValueChange={(v) => {
					if (!v) return;
					patch({ public_visibility: v as OverviewFilters['public_visibility'] });
				}}
			>
				<Select.Trigger
					id="overview-public-visibility"
					class="h-9 w-full min-w-0 overflow-hidden"
					aria-label={t.filterPublicVisibility}
					title={`${t.filterPublicVisibility}: ${publicVisibilityLabel}`}
				>
					<span class="min-w-0 flex-1 truncate">
						{publicVisibilityLabel}
					</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label={t.all} />
					<Select.Item value="visible" label={t.publicVisibility.visible} />
					<Select.Item value="hidden" label={t.publicVisibility.hidden} />
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<div class="min-w-[9rem] flex-1 basis-[9rem] space-y-1.5">
		<Label for="overview-stay" class="text-sm font-semibold text-slate-700">{t.filterStay}</Label>
		<Select.Root
			type="single"
			value={stayBucketValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({ stay_bucket: v as OverviewFilters['stay_bucket'] });
			}}
		>
			<Select.Trigger
				id="overview-stay"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label={t.filterStay}
				title={`${t.filterStay}: ${stayBucketLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{stayBucketLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label={t.all} />
				<Select.Item value="present" label={t.stayBucket.present} />
				<Select.Item value="forecast" label={t.stayBucket.forecast} />
				<Select.Item value="pre_registered" label={t.stayBucket.pre_registered} />
				<Select.Item value="checked_out" label={t.stayBucket.checked_out} />
			</Select.Content>
		</Select.Root>
	</div>

	<div class="min-w-[9rem] flex-[1.4] basis-[12rem] space-y-1.5">
		<Label for="overview-source" class="text-sm font-semibold text-slate-700"
			>{t.filterPreRegSource}</Label
		>
		<Select.Root
			type="single"
			value={sourceValue}
			onValueChange={(v) => {
				if (!v) return;
				patch({ source: v as OverviewFilters['source'] });
			}}
		>
			<Select.Trigger
				id="overview-source"
				class="h-9 w-full min-w-0 overflow-hidden"
				aria-label={t.filterPreRegSource}
				title={`${t.filterPreRegSource}: ${sourceLabel}`}
			>
				<span class="min-w-0 flex-1 truncate">
					{sourceLabel}
				</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="all" label={t.all} />
				<Select.Item value="unassigned" label={t.source.unassigned} />
				<Select.Item value="bound" label={t.source.bound} />
			</Select.Content>
		</Select.Root>
	</div>

	{#if showHouseholdFilter}
		<div class="min-w-[12rem] flex-[1.5] basis-[14rem] space-y-1.5">
			<Label for="overview-household" class="text-sm font-semibold text-slate-700"
				>{t.filterHousehold}</Label
			>
			<HouseholdSearchSelect
				mode={householdMode}
				shelterCode={filters.shelter_code}
				value={filters.household_id ?? ''}
				onSelect={(item) => patch({ household_id: item?.id || undefined })}
				placeholder={t.filterHouseholdPlaceholder}
			/>
		</div>
	{/if}

	{#if showSearch}
		<div class="min-w-[12rem] flex-1 basis-[12rem] space-y-1.5">
			<Label for="overview-q" class="text-sm font-semibold text-slate-700">{t.filterSearch}</Label>
			<Input
				id="overview-q"
				type="search"
				placeholder={t.filterSearchPlaceholder}
				class="h-9"
				value={filters.q ?? ''}
				oninput={(e) => {
					const q = e.currentTarget.value.trim();
					patch({ q: q || undefined });
				}}
			/>
		</div>
	{/if}
</div>
