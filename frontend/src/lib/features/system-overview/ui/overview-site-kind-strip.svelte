<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { formatMasterLabelByCode, useMasterData } from '$lib/features/master-data';
	import { langState } from '$lib/states/i18n.svelte';
	import { STAFF_SYSTEM_OVERVIEW_I18N } from '$lib/constants/i18n/staff-system-overview';
	import { getTranslation } from '$lib/utils/i18n';
	import type { OverviewSummary } from '../domain/schemas';

	let {
		summary,
		loading = false
	}: {
		summary: OverviewSummary | undefined;
		loading?: boolean;
	} = $props();

	const siteKindQuery = useMasterData(() => 'site_kind');
	const items = $derived(siteKindQuery.data?.items ?? []);
	const t = $derived(getTranslation(STAFF_SYSTEM_OVERVIEW_I18N, langState.current));

	// Master order; active kinds always shown (even 0). A deactivated kind still holding
	// shelters is appended so the cards keep summing to sites_total.
	const cards = $derived.by(() => {
		const counts = summary?.sites_by_site_kind ?? {};
		const codes = items.filter((i) => i.status === 'active').map((i) => i.code);
		for (const code of Object.keys(counts)) {
			if (!codes.includes(code) && (counts[code] ?? 0) > 0) codes.push(code);
		}
		const kindCards = codes.map((code) => ({
			code,
			label: formatMasterLabelByCode(code, items, langState.current),
			count: counts[code] ?? 0
		}));
		// External shelters are their own card (always shown), never folded into a kind.
		return [
			...kindCards,
			{ code: '__external__', label: t.externalSites, count: summary?.sites_external ?? 0 }
		];
	});
</script>

{#if loading && !summary}
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<Skeleton class="h-20 w-full rounded-xl" />
		<Skeleton class="h-20 w-full rounded-xl" />
	</div>
{:else if summary}
	<!-- One equal-width column per card on wide screens, so the row always spans the full width. -->
	<div
		class="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(var(--cards),minmax(0,1fr))]"
		style:--cards={cards.length}
		data-testid="site-kind-strip"
	>
		{#each cards as card (card.code)}
			<Card.Root class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
				<Card.Header class="pb-1">
					<Card.Title class="text-sm font-semibold text-slate-700">{card.label}</Card.Title>
				</Card.Header>
				<Card.Content class="flex items-baseline gap-2">
					<span
						class="text-3xl font-bold text-slate-900 tabular-nums"
						data-testid="site-kind-count"
					>
						{card.count}
					</span>
					<span class="text-sm text-slate-500">{t.siteUnit}</span>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>
{/if}
