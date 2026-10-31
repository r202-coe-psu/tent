<script lang="ts">
	import Navigation from '@lucide/svelte/icons/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import { dropOffDirectionsUrl, type DropOffPoint } from '../domain/drop-off';

	/** `directions={false}` keeps the destination on record but drops the call to travel there. */
	let { point, directions = true }: { point: DropOffPoint; directions?: boolean } = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const directionsHref = $derived(directions ? dropOffDirectionsUrl(point) : null);
</script>

<div data-testid="drop-off-card">
	<p class="mt-0.5 font-semibold text-foreground">{point.name}</p>
	{#if point.address}
		<p class="mt-0.5 text-2xs text-muted-foreground">{point.address}</p>
	{/if}
	{#if point.note}
		<p class="mt-0.5 text-2xs text-muted-foreground">{point.note}</p>
	{/if}
	{#if directionsHref}
		<Button
			href={directionsHref}
			target="_blank"
			rel="noopener noreferrer"
			size="sm"
			class="mt-2 h-9 rounded-xl px-3 text-xs font-bold"
		>
			<Navigation class="h-3.5 w-3.5" />
			{t.navigateGoogleMaps}
		</Button>
	{/if}
</div>
