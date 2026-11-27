<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import House from '@lucide/svelte/icons/house';
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Ban from '@lucide/svelte/icons/ban';
	import MapPin from '@lucide/svelte/icons/map-pin';
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

	// Icon + icon colour per card (same look as the evacuee KPI cards). The icon, not the
	// colour, carries the meaning; closed/cancelled stays neutral slate, never a status colour.
	// Unknown kinds fall back to a pin icon with a tone cycled by position.
	const KIND_STYLE: Record<string, { icon: typeof MapPin; tone: string }> = {
		evacuation_center: { icon: Building2, tone: 'text-blue-500' },
		host_house: { icon: House, tone: 'text-teal-500' },
		test_center: { icon: FlaskConical, tone: 'text-purple-500' },
		__external__: { icon: ExternalLink, tone: 'text-orange-500' },
		__closed_or_cancelled__: { icon: Ban, tone: 'text-slate-400' }
	};
	const FALLBACK_TONES = ['text-sky-500', 'text-pink-500', 'text-indigo-500', 'text-cyan-600'];
	const styleOf = (code: string, i: number) =>
		KIND_STYLE[code] ?? { icon: MapPin, tone: FALLBACK_TONES[i % FALLBACK_TONES.length] };

	// Master order; active kinds always shown (even 0). A deactivated kind still holding
	// shelters is appended so the kind + external cards keep summing to sites_total.
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
			{ code: '__external__', label: t.externalSites, count: summary?.sites_external ?? 0 },
			// CR-266 FR-13a: closed + cancelled shelters, kept out of every card above.
			{
				code: '__closed_or_cancelled__',
				label: t.closedOrCancelledSites,
				count: summary?.sites_closed_or_cancelled ?? 0
			}
		];
	});
</script>

{#if loading && !summary}
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<Skeleton class="h-16 w-full rounded-xl" />
		<Skeleton class="h-16 w-full rounded-xl" />
	</div>
{:else if summary}
	<!-- One equal-width column per card on wide screens, so the row always spans the full width. -->
	<div
		class="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(var(--cards),minmax(0,1fr))]"
		style:--cards={cards.length}
		data-testid="site-kind-strip"
	>
		{#each cards as card, i (card.code)}
			{@const style = styleOf(card.code, i)}
			<div class="min-w-0 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-2xs">
				<div class="flex items-start justify-between gap-2">
					<h3 class="text-xs leading-snug font-medium text-slate-600">{card.label}</h3>
					<style.icon class="h-4 w-4 shrink-0 {style.tone}" aria-hidden="true" />
				</div>
				<div class="mt-1 flex items-baseline gap-1.5">
					<span class="text-xl font-bold text-slate-900 tabular-nums" data-testid="site-kind-count">
						{card.count}
					</span>
					<span class="text-xs text-slate-500">{t.siteUnit}</span>
				</div>
			</div>
		{/each}
	</div>
{/if}
