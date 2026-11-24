<script lang="ts">
	import { STAFF_SYSTEM_OVERVIEW_I18N } from '$lib/constants/i18n/staff-system-overview';
	import { getTranslation } from '$lib/utils/i18n';
	import { resolve } from '$app/paths';
	import { parseDate } from '@internationalized/date';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import Eye from '@lucide/svelte/icons/eye';
	import { Badge } from '$lib/components/ui/badge';
	import { DateRangePicker } from '$lib/components/ui/date-picker';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { formatMasterLabelByCode, useMasterData } from '$lib/features/master-data';
	import { langState } from '$lib/states/i18n.svelte';
	import { thailandDateString, type OverviewSiteRow } from '../domain/schemas';

	let {
		sites,
		loading = false,
		movementFrom,
		movementTo,
		onMovementRangeChange
	}: {
		sites: OverviewSiteRow[] | undefined;
		loading?: boolean;
		movementFrom: string; // YYYY-MM-DD
		movementTo: string;
		onMovementRangeChange: (next: { movement_from: string; movement_to: string }) => void;
	} = $props();

	const maxValue = $derived(parseDate(thailandDateString()));

	const t = $derived(getTranslation(STAFF_SYSTEM_OVERVIEW_I18N, langState.current));

	function formatPct(value: number | null): string {
		return value == null ? '—' : `${value}%`;
	}

	const siteKindQuery = useMasterData(() => 'site_kind');
	const siteKindLabel = (code: string) =>
		formatMasterLabelByCode(code, siteKindQuery.data?.items ?? [], langState.current);

	function statusLabel(status: string): string {
		return t.operationStatus[status] ?? status;
	}
</script>

<Card.Root class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header class="grid-cols-[minmax(0,1fr)] space-y-4">
		<div>
			<Card.Title class="text-lg font-bold text-slate-900">{t.sitesTitle}</Card.Title>
			<Card.Description class="text-sm text-slate-500">
				{t.sitesDescription}
			</Card.Description>
		</div>
		<div class="flex flex-wrap items-end gap-3">
			<div class="max-w-full min-w-0 space-y-1.5">
				<Label for="sites-movement-range" class="text-sm font-semibold text-slate-700">
					{t.movementRange}
				</Label>
				<DateRangePicker
					id="sites-movement-range"
					ariaLabel={t.movementRange}
					from={movementFrom}
					to={movementTo}
					{maxValue}
					onRangeChange={({ from, to }) => {
						onMovementRangeChange({ movement_from: from, movement_to: to });
					}}
					class="h-9 min-w-0 sm:min-w-[16rem]"
				/>
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if loading && !sites}
			<Skeleton class="h-48 w-full rounded-xl" />
		{:else if !sites || sites.length === 0}
			<p class="py-6 text-center text-sm text-slate-500">{t.sitesEmpty}</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-slate-200/80">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>{t.colName}</Table.Head>
							<Table.Head>{t.colKind}</Table.Head>
							<Table.Head>{t.colStatus}</Table.Head>
							<Table.Head class="text-right">{t.colPresent}</Table.Head>
							<Table.Head class="text-right">{t.colForecast}</Table.Head>
							<Table.Head class="text-right">{t.colPresentPct}</Table.Head>
							<Table.Head class="text-right">{t.colForecastPct}</Table.Head>
							<Table.Head class="text-right">{t.colCheckin}</Table.Head>
							<Table.Head class="text-right">{t.colCheckout}</Table.Head>
							<Table.Head>{t.colMap}</Table.Head>
							<Table.Head></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each sites as site (site.shelter_code)}
							<Table.Row>
								<Table.Cell class="font-medium text-slate-900">
									<div>{site.name}</div>
									<div class="text-xs text-slate-500">{site.shelter_code}</div>
								</Table.Cell>
								<Table.Cell class="text-sm text-slate-700">
									{siteKindLabel(site.site_kind)}
								</Table.Cell>
								<Table.Cell class="text-sm text-slate-700">
									{statusLabel(site.operation_status)}
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{site.present}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{site.forecast}</Table.Cell>
								<Table.Cell class="text-right tabular-nums"
									>{formatPct(site.present_pct)}</Table.Cell
								>
								<Table.Cell class="text-right tabular-nums"
									>{formatPct(site.forecast_pct)}</Table.Cell
								>
								<Table.Cell class="text-right font-semibold text-emerald-700 tabular-nums">
									{site.checkin}
								</Table.Cell>
								<Table.Cell class="text-right font-semibold text-red-700 tabular-nums">
									{site.checkout}
								</Table.Cell>
								<Table.Cell>
									{#if site.has_coords}
										<Badge
											variant="outline"
											class="border-emerald-200 bg-emerald-50 text-emerald-900"
										>
											{t.hasMapLocation}
										</Badge>
									{:else}
										<Badge variant="outline" class="border-slate-200 bg-slate-50 text-slate-600">
											{t.noMapLocation}
										</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell>
									<a
										href={resolve(site.dashboard_href as '/back-office/evacuee-management')}
										class="inline-flex size-8 items-center justify-center rounded-md text-[#0284C7] hover:bg-sky-50"
										aria-label={t.dashboard}
										title={t.dashboard}
									>
										<Eye class="size-4" aria-hidden="true" />
									</a>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
