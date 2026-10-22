<script lang="ts">
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		CreatePrinterDialog,
		PRINTERS_I18N,
		PrinterAdminList,
		RevealPrinterSecretDialog,
		usePrinterAdminList,
		type PrinterSecretResponse
	} from '$lib/features/printers';

	const t = $derived(getTranslation(PRINTERS_I18N, languageStore.current).admin);

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const printersQuery = usePrinterAdminList(() => activeShelter);

	let createOpen = $state(false);
	let revealOpen = $state(false);
	let revealReason = $state<'created' | 'rotated'>('created');
	let revealed = $state.raw<PrinterSecretResponse | null>(null);

	const printers = $derived(printersQuery.data?.printers ?? []);

	function handleSecret(result: PrinterSecretResponse, reason: 'created' | 'rotated') {
		revealed = result;
		revealReason = reason;
		revealOpen = true;
	}

	/** The reveal dialog closed: keep no plaintext secret in page state. */
	function handleRevealClosed() {
		revealed = null;
	}
</script>

<svelte:head>
	<title>{t.pageTitle} — SmartShelter</title>
</svelte:head>

<StaffPageShell title={t.pageTitle} description={t.pageDescription}>
	{#snippet actions()}
		<Button onclick={() => (createOpen = true)} class="btn-primary-brand shrink-0 gap-2">
			<Plus class="h-4 w-4" />
			{t.register}
		</Button>
	{/snippet}

	<div class={spatial.container.staffPageCard}>
		{#if printersQuery.isLoading}
			<div class="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
				<div
					class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
				></div>
				<p>{t.loading}</p>
			</div>
		{:else if printersQuery.isError}
			<div class="px-6 py-16 text-center text-sm text-destructive">
				{printersQuery.error instanceof Error ? printersQuery.error.message : t.loadFailed}
			</div>
		{:else}
			<PrinterAdminList {printers} onrotated={(result) => handleSecret(result, 'rotated')} />
		{/if}
	</div>
</StaffPageShell>

<CreatePrinterDialog
	bind:open={createOpen}
	fixedShelterCode={activeShelter}
	oncreated={(created) => handleSecret(created, 'created')}
/>
<RevealPrinterSecretDialog
	bind:open={revealOpen}
	device={revealed?.device ?? null}
	secret={revealed?.secret ?? null}
	reason={revealReason}
	onclose={handleRevealClosed}
/>
