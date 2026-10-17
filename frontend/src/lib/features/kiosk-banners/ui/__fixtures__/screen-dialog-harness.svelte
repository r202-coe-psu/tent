<script lang="ts">
	import type { KioskBannerSummary } from '../../data/kiosk-banner.repository';
	import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import KioskBannerScreenDialog from '../kiosk-banner-screen-dialog.svelte';

	/**
	 * Test-only parent: owns the bound `draft` (as the page does), echoes its `_id` order, and can
	 * swap `current` for `refreshed` to simulate a refetch after a status toggle.
	 */
	let {
		screen = 'compact',
		initialCurrent,
		refreshed = initialCurrent,
		expired = [],
		initialDraft = null,
		loading = false,
		errorMessage = null,
		now,
		onclose
	}: {
		screen?: KioskScreenType;
		initialCurrent: KioskBannerSummary[];
		refreshed?: KioskBannerSummary[];
		expired?: KioskBannerSummary[];
		initialDraft?: KioskBannerSummary[] | null;
		loading?: boolean;
		errorMessage?: string | null;
		now: Date;
		onclose: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let current = $state.raw(initialCurrent);
	// svelte-ignore state_referenced_locally
	let draft = $state.raw<KioskBannerSummary[] | null>(initialDraft);
</script>

<KioskBannerScreenDialog
	{screen}
	{current}
	{expired}
	{now}
	shelterCode="SH001"
	{loading}
	{errorMessage}
	bind:draft
	{onclose}
/>
<button type="button" data-testid="refetch" onclick={() => (current = refreshed)}>refetch</button>
<output data-testid="draft">{draft ? draft.map((item) => item._id).join(',') : 'none'}</output>
