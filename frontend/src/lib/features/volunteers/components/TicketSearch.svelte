<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Camera from '@lucide/svelte/icons/camera';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';
	import VolunteerQrScannerModal from './VolunteerQrScannerModal.svelte';

	let { onSearch } = $props<{
		onSearch: (query: string) => void;
	}>();

	const t = $derived(jobsI18n[languageStore.current]);

	let searchQuery = $state('');
	let isScannerOpen = $state(false);
	let errorMessage = $state('');

	function handleSearch(e: Event) {
		e.preventDefault();
		errorMessage = '';
		const trimmed = searchQuery.trim();
		if (!trimmed) {
			errorMessage = t.ticketErrorEmpty;
			return;
		}
		onSearch(trimmed);
	}

	function handleScan(scannedToken: string) {
		errorMessage = '';
		const trimmed = scannedToken.trim();
		if (trimmed) {
			searchQuery = trimmed;
			onSearch(trimmed);
		}
	}
</script>

<div class="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-6 shadow-sm md:p-8">
	<h2 class="flex items-center gap-2 text-base font-bold text-foreground">
		<QrCode class="h-5 w-5 text-primary" />
		{t.ticketSearchTitle}
	</h2>
	<p class="mt-1 text-xs text-muted-foreground">
		{t.ticketSearchDesc}
	</p>

	<!-- Search Bar -->
	<form onsubmit={handleSearch} class="mt-6 flex flex-col gap-3 sm:flex-row">
		<div class="relative flex-1">
			<input
				type="text"
				bind:value={searchQuery}
				placeholder={t.ticketSearchPlaceholder}
				class="w-full rounded-xl border border-border bg-muted/20 px-4 py-3 pl-11 text-sm text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			/>
			<Search class="absolute top-3.5 left-4 h-4.5 w-4.5 text-muted-foreground" />
		</div>
		<div class="flex gap-2">
			<button
				type="button"
				onclick={() => (isScannerOpen = true)}
				class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-bold text-primary transition-colors hover:bg-primary/20 active:scale-95"
				title={t.ticketScanTooltip}
			>
				<Camera class="h-4 w-4" />
				<span class="hidden sm:inline">{t.ticketScanQr}</span>
			</button>
			<button
				type="submit"
				class="flex-1 cursor-pointer rounded-xl bg-primary px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-dark active:scale-95 sm:flex-initial"
			>
				{t.ticketSearchButton}
			</button>
		</div>
	</form>

	{#if errorMessage}
		<div
			class="mt-4 flex items-center gap-2 rounded-xl bg-destructive/10 p-3 text-xs font-medium text-destructive"
		>
			<CircleAlert class="h-4 w-4 shrink-0" />
			<span>{errorMessage}</span>
		</div>
	{/if}

	<!-- Scanner Modal Component -->
	<VolunteerQrScannerModal
		bind:isOpen={isScannerOpen}
		onScan={handleScan}
		title={t.ticketScanTitle}
	/>

	<!-- Search Placeholder Card -->
	<div class="mt-8 rounded-2xl border border-dashed border-border bg-muted/5 p-10 text-center">
		<div
			class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card text-muted-foreground/60 shadow-xs"
		>
			<QrCode class="h-7 w-7" />
		</div>
		<h4 class="text-sm font-bold text-foreground">{t.ticketEmptySearchTitle}</h4>
		<p class="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
			{t.ticketEmptySearchDesc}
		</p>
	</div>
</div>
