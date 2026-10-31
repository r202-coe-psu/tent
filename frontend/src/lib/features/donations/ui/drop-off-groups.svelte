<script lang="ts">
	import Navigation from '@lucide/svelte/icons/navigation';
	import Clock from '@lucide/svelte/icons/clock';
	import PackageCheck from '@lucide/svelte/icons/package-check';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import { dropOffDirectionsUrl } from '../domain/drop-off';
	import type { DropOffDestinationGroup, DropOffGroupStatus } from '../domain/line-points';

	/**
	 * A booking split across drop-off points, one card per point (CR-206 FR-MP-13): where to
	 * go, what to bring there, and whether that point has taken it. Lines whose point is gone
	 * share the "any point" card with the shelter address (FR-MP-16).
	 */
	let {
		groups,
		lineNames,
		directions = true,
		showPending = true,
		showReceived = true
	}: {
		groups: DropOffDestinationGroup[];
		/** Display name of each line, by position in the booking's `items`. */
		lineNames: readonly string[];
		/** `false` keeps the destinations on record but drops the call to travel there. */
		directions?: boolean;
		/** "รอรับ" means nothing once the booking is closed, so the caller can hide it. */
		showPending?: boolean;
		showReceived?: boolean;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	function statusLabel(status: DropOffGroupStatus): string {
		if (status === 'received') return t.pointGroupReceived;
		if (status === 'received_at_shelter') return t.pointGroupReceivedAtShelter;
		return t.pointGroupPending;
	}

	function showStatus(status: DropOffGroupStatus): boolean {
		return status === 'pending' ? showPending : showReceived;
	}
</script>

<ul class="mt-1 space-y-3" data-testid="drop-off-groups">
	{#each groups as group (group.key)}
		{@const href = directions ? dropOffDirectionsUrl(group.point) : null}
		<li
			class="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xs"
			data-testid="drop-off-group"
			data-point-id={group.key}
		>
			<div class="flex flex-wrap items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-sm font-bold text-slate-900">{group.point.name}</p>
					{#if !group.anyPoint && group.point.shelterName !== group.point.name}
						<p class="text-xs text-slate-500">{group.point.shelterName}</p>
					{/if}
				</div>
				{#if showStatus(group.status)}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold {group.status ===
						'pending'
							? 'border-amber-200 bg-amber-50 text-amber-900'
							: 'border-emerald-200 bg-emerald-50 text-emerald-900'}"
						data-testid="drop-off-group-status"
					>
						{#if group.status === 'pending'}
							<Clock class="h-3.5 w-3.5" />
						{:else}
							<PackageCheck class="h-3.5 w-3.5" />
						{/if}
						{statusLabel(group.status)}
					</span>
				{/if}
			</div>
			{#if group.point.address}
				<p class="text-xs text-slate-500">{group.point.address}</p>
			{/if}
			{#if group.point.note}
				<p class="text-xs text-slate-600">{group.point.note}</p>
			{/if}
			<div>
				<p class="text-xs font-bold text-slate-500">{t.pointGroupItemsLabel}</p>
				<ul class="mt-0.5 list-inside list-disc text-sm text-slate-700">
					{#each group.lineNos as lineNo (lineNo)}
						<li>{lineNames[lineNo] ?? '—'}</li>
					{/each}
				</ul>
			</div>
			{#if href}
				<Button
					{href}
					target="_blank"
					rel="noopener noreferrer"
					size="sm"
					class="h-10 rounded-xl px-3 text-xs font-bold"
				>
					<Navigation class="h-3.5 w-3.5" />
					{t.navigateGoogleMaps}
				</Button>
			{/if}
		</li>
	{/each}
</ul>
