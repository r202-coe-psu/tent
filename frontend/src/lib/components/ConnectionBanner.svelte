<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { STAFF_CHROME_I18N } from '$lib/constants/i18n/staff-chrome';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	const t = $derived(getTranslation(STAFF_CHROME_I18N, langState.current).connection);

	async function handleRetry() {
		await endpointStore.forceRetry();
	}
</script>

{#if endpointStore.status === 'disconnected'}
	<div
		class="flex items-center justify-between gap-4 bg-destructive px-4 py-2 text-sm text-destructive-foreground"
		role="alert"
	>
		<span>{t.disconnected}</span>
		<Button variant="secondary" size="sm" onclick={handleRetry}>{t.retry}</Button>
	</div>
{/if}
