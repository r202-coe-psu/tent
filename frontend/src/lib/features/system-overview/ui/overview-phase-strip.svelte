<script lang="ts">
	import { STAFF_SYSTEM_OVERVIEW_I18N } from '$lib/constants/i18n/staff-system-overview';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { OverviewSummary } from '../domain/schemas';

	let {
		summary,
		loading = false
	}: {
		summary: OverviewSummary | undefined;
		loading?: boolean;
	} = $props();

	const t = $derived(getTranslation(STAFF_SYSTEM_OVERVIEW_I18N, langState.current));

	function formatPct(value: number | null | undefined): string {
		return value == null ? '—' : `${value}%`;
	}
</script>

{#if loading && !summary}
	<div class="grid gap-4 md:grid-cols-2">
		<Skeleton class="h-36 w-full rounded-xl" />
		<Skeleton class="h-36 w-full rounded-xl" />
	</div>
{:else}
	<div class="grid gap-4 md:grid-cols-2">
		<Card.Root class="rounded-xl border border-emerald-200 bg-white shadow-2xs">
			<Card.Header class="pb-2">
				<Card.Title class="text-base font-semibold text-emerald-900">{t.preRegTitle}</Card.Title>
				<Card.Description class="text-sm text-slate-500">{t.preRegDescription}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">{t.preRegNoShelter}</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.unassigned_members ?? '—'}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">{t.preRegAtShelter}</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.pre_registered_at_sites ?? '—'}
					</span>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root class="rounded-xl border border-sky-200 bg-white shadow-2xs">
			<Card.Header class="pb-2">
				<Card.Title class="text-base font-semibold text-sky-900">{t.inShelterTitle}</Card.Title>
				<Card.Description class="text-sm text-slate-500">{t.inShelterDescription}</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2">
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">{t.current}</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.present_total ?? '—'}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-2">
					<span class="text-sm text-slate-600">{t.forecast}</span>
					<span class="text-2xl font-bold text-slate-900 tabular-nums">
						{summary?.forecast_total ?? '—'}
					</span>
				</div>
				<div class="flex items-baseline justify-between gap-2 pt-1 text-sm text-slate-600">
					<span>{t.avgCapacityUse}</span>
					<span class="font-semibold text-slate-800 tabular-nums">
						{t.avgCapacityValue(
							formatPct(summary?.avg_present_pct),
							formatPct(summary?.avg_forecast_pct)
						)}
					</span>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
{/if}
