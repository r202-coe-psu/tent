<script lang="ts">
	import IdCard from '@lucide/svelte/icons/id-card';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';

	interface Props {
		shelterCode?: string;
		disabled?: boolean;
	}

	let { shelterCode = '', disabled = false }: Props = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	let isRedirecting = $state(false);

	function handleRealConnect() {
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

<div class="rounded-xl border border-primary/20 bg-primary/5 p-3.5 sm:p-4">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-start gap-2.5">
			<div
				class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
			>
				<IdCard class="size-4" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<span class="text-sm font-semibold text-foreground">{t.thaidTitle}</span>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{t.thaidDesc}
				</p>
			</div>
		</div>

		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={disabled || isRedirecting}
			onclick={handleRealConnect}
			class="min-h-10 border-primary/30 text-primary hover:bg-primary/10"
		>
			{#if isRedirecting}
				<Loader2 class="mr-1.5 size-4 animate-spin" />
				<span>{t.thaidConnecting}</span>
			{:else}
				<Sparkles class="mr-1.5 size-4" />
				<span>{t.thaidConnect}</span>
			{/if}
		</Button>
	</div>
</div>
