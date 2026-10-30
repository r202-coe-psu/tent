<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';

	interface Props {
		shelterCode?: string;
		disabled?: boolean;
		/** Onsite: open the cross-device QR dialog instead of leaving the page. */
		onConnect?: () => void;
	}

	let { shelterCode = '', disabled = false, onConnect }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	let isRedirecting = $state(false);

	function handleRealConnect() {
		if (onConnect) {
			onConnect();
			return;
		}
		if (isRedirecting) return;
		isRedirecting = true;
		const currentUrl = new URL(window.location.href);
		currentUrl.searchParams.delete('error');
		currentUrl.searchParams.delete('thaid');
		if (shelterCode) {
			currentUrl.searchParams.set('shelter', shelterCode);
		}
		const returnTo = currentUrl.pathname + (currentUrl.search ? currentUrl.search : '');
		window.location.href = `/api/v1/auth/oauth/thaid/start?mode=register&return_to=${encodeURIComponent(returnTo)}`;
	}
</script>

<div class="space-y-4">
	<div class="space-y-1.5">
		<Button
			type="button"
			disabled={disabled || isRedirecting}
			onclick={handleRealConnect}
			class="h-11 w-full gap-2 rounded-xl text-base font-semibold shadow-xs"
		>
			{#if isRedirecting}
				<Loader2 class="size-5 animate-spin" />
				<span>{t.thaidConnecting}</span>
			{:else}
				<img src="/thaid-logo.png" alt="" class="size-6 rounded object-contain" />
				<span>{t.thaidConnect}</span>
			{/if}
		</Button>
		<p class="text-center text-xs text-muted-foreground">{t.thaidDesc}</p>
	</div>

	<div class="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
		<span class="h-px flex-1 bg-border"></span>
		<span>{t.thaidOrManual}</span>
		<span class="h-px flex-1 bg-border"></span>
	</div>
</div>
