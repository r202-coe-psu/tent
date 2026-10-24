<script lang="ts">
	import type { KioskBannerSummary } from '../../data/kiosk-banner.repository';
	import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import KioskBannerScreenManager from '../kiosk-banner-screen-manager.svelte';

	/**
	 * Test-only parent: owns the bound `draft` (as the page does), echoes its `_id` order, and can
	 * swap `current` for `refreshed` to simulate a refetch after a status toggle.
	 */
	let {
		screen = 'compact',
		groupId = 'kiosk_banner_group:A',
		initialCurrent,
		refreshed = initialCurrent,
		expired = [],
		initialDraft = null,
		loading = false,
		errorMessage = null,
		now
	}: {
		screen?: KioskScreenType;
		groupId?: string;
		initialCurrent: KioskBannerSummary[];
		refreshed?: KioskBannerSummary[];
		expired?: KioskBannerSummary[];
		initialDraft?: KioskBannerSummary[] | null;
		loading?: boolean;
		errorMessage?: string | null;
		now: Date;
	} = $props();

	// svelte-ignore state_referenced_locally
	let current = $state.raw(initialCurrent);
	let previewOpen = $state(false);
	// svelte-ignore state_referenced_locally
	let draft = $state.raw<KioskBannerSummary[] | null>(initialDraft);
</script>

<KioskBannerScreenManager
	{screen}
	{groupId}
	{current}
	{expired}
	{now}
	shelterCode="SH001"
	{loading}
	{errorMessage}
	bind:draft
	bind:previewOpen
/>
<button type="button" data-testid="open-preview" onclick={() => (previewOpen = true)}
	>preview</button
>
<button type="button" data-testid="refetch" onclick={() => (current = refreshed)}>refetch</button>
<output data-testid="draft">{draft ? draft.map((item) => item._id).join(',') : 'none'}</output>
