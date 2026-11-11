<script lang="ts">
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { PUBLIC_THAID_SCAN_I18N, thaidScanMessage } from '$lib/constants/i18n/public-thaid-scan';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	const errorParam = $derived(page.url.searchParams.get('error'));
	const isError = $derived(Boolean(errorParam));
	const isKioskFlow = $derived(page.url.searchParams.get('flow') === 'kiosk');

	const t = $derived(getTranslation(PUBLIC_THAID_SCAN_I18N, langState.current));
	const errorMessage = $derived(thaidScanMessage(errorParam, langState.current, isKioskFlow));
</script>

<svelte:head>
	<title>{isError ? t.pageTitleError : t.pageTitleSuccess} | SmartShelter</title>
</svelte:head>

<div class="flex min-h-[70vh] items-center justify-center px-4 py-12">
	<div
		class="w-full max-w-md rounded-2xl border border-border/80 bg-card p-6 text-center shadow-lg sm:p-8"
	>
		{#if isError}
			<div
				class="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive"
			>
				<AlertTriangle class="size-8" />
			</div>
			<h2 class="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
				{t.errorHeading}
			</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				{errorMessage}
			</p>
			<div class="mt-6">
				<a href={resolve('/')} class="inline-block w-full">
					<Button variant="outline" class="w-full">
						<ArrowLeft class="mr-2 size-4" />
						{t.backHome}
					</Button>
				</a>
			</div>
		{:else}
			<div
				class="mx-auto mb-4 flex size-16 animate-in items-center justify-center rounded-full bg-primary/10 text-primary duration-300 zoom-in-50"
			>
				<CheckCircle2 class="size-9" />
			</div>
			{#if isKioskFlow}
				<h2 class="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
					{t.kioskSuccessHeading}
				</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					{t.kioskSuccessBody}
				</p>
			{:else}
				<h2 class="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
					{t.successHeading}
				</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					{t.successBody}
				</p>
				<div
					class="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs font-medium text-primary"
				>
					{t.successSaved}<br />
					{t.successCloseWindow}
				</div>
			{/if}
		{/if}
	</div>
</div>
