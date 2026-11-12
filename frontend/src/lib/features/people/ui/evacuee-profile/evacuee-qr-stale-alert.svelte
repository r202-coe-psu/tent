<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button';
	import type { EvacueeQrPrintRef } from '$lib/utils/evacuee-qr';
	import type { VulnerabilityMarker } from '$lib/utils/vulnerability-marker';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { isQrCardStale } from '../../domain/qr-card-staleness';
	import { EVACUEE_QR_STALE_ALERT_I18N } from '../_constants/evacuee-qr-stale-alert.i18n';

	/**
	 * Non-blocking warning (CR-233 FR-EQR-57, #1301): the vulnerability level changed since the
	 * latest printed QR card. Shows only the message — never the group names or the level itself.
	 */
	let {
		current,
		prints,
		onReprint
	}: {
		current: VulnerabilityMarker | null;
		prints: readonly EvacueeQrPrintRef[];
		onReprint: () => void;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_QR_STALE_ALERT_I18N, langState.current));
</script>

{#if isQrCardStale(current, prints)}
	<div
		class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
		role="status"
	>
		<p class="flex min-w-0 items-center gap-2">
			<TriangleAlert class="size-4 shrink-0" aria-hidden="true" />
			<span>{t.message}</span>
		</p>
		<Button type="button" size="sm" variant="outline" onclick={onReprint}>{t.reprint}</Button>
	</div>
{/if}
