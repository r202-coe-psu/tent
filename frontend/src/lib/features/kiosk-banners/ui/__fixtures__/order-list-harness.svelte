<script lang="ts">
	import type { KioskBannerSummary } from '../../data/kiosk-banner.repository';
	import KioskBannerOrderList from '../kiosk-banner-order-list.svelte';

	/** Test-only parent: owns the bound `items` and echoes the resulting `_id` order. */
	let {
		initial,
		now,
		disabled = false,
		withRowActions = false
	}: {
		initial: KioskBannerSummary[];
		now: Date;
		disabled?: boolean;
		withRowActions?: boolean;
	} = $props();

	// svelte-ignore state_referenced_locally
	let items = $state.raw(initial);
</script>

{#snippet action(banner: KioskBannerSummary)}
	<span data-testid="row-action">{banner._id}</span>
{/snippet}

<KioskBannerOrderList
	bind:items
	{now}
	{disabled}
	rowActions={withRowActions ? action : undefined}
/>
<output data-testid="order">{items.map((item) => item._id).join(',')}</output>
