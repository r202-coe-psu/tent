<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Printer from '@lucide/svelte/icons/printer';
	import { Button } from '$lib/components/ui/button/index.js';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION,
		KIOSK_CHECK_IN_TICKS,
		KioskCheckInWizard,
		KioskInlineAlert,
		KioskLabelSheet,
		KioskNoticePanel,
		KioskPrintStatus,
		navigateToKioskHome,
		prepareKioskQrImage,
		printKioskQrLabels,
		readKioskDisplayQuery,
		walkInSession,
		type KioskQrImage
	} from '$lib/features/kiosk';
	import { KIOSK_REGISTER_DONE_I18N } from './done-page.i18n';

	const t = $derived(getTranslation(KIOSK_REGISTER_DONE_I18N, languageStore.current));

	/** How long «printed» stays on screen before the status card goes away. */
	const PRINT_DONE_VISIBLE_MS = 2500;

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	// Read before onMount forgets the walk-in: a ThaiD walk-in has no card in the reader, and the
	// registration (QR + label text) only lives here. Empty on a reload: nothing left to print.
	const viaThaid = walkInSession.source === 'thaid';
	const registration = walkInSession.registration;
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	let qrImage = $state.raw<KioskQrImage | null>(null);
	let printPhase = $state<'idle' | 'printing' | 'done'>('idle');
	let printError = $state('');
	let doneTimer: ReturnType<typeof setTimeout> | null = null;
	const labels = $derived(
		registration
			? [
					{
						key: registration.evacuee_id,
						qrSrc: qrImage?.src,
						qrSizeMm: qrImage?.sizeMm,
						name: registration.label.name,
						emergencyPhone: registration.label.emergency_phone,
						checkedCount: KIOSK_CHECK_IN_TICKS
					}
				]
			: []
	);

	onMount(() => {
		walkInSession.clear();
		idleTimeout.start();
		void printLabel();
		return () => {
			idleTimeout.stop();
			if (doneTimer) clearTimeout(doneTimer);
		};
	});

	function activity() {
		idleTimeout.recordActivity();
	}

	function returnHome() {
		walkInSession.clear();
		navigateToKioskHome(contextQuery);
	}

	async function printLabel(): Promise<void> {
		if (!registration || printPhase === 'printing') return;
		// Not sent home while the label comes out; resuming restarts the idle countdown.
		idleTimeout.setPaused(true);
		printError = '';
		if (doneTimer) clearTimeout(doneTimer);
		printPhase = 'printing';
		try {
			qrImage ??= await prepareKioskQrImage(registration.qr_payload);
			// No scanner client (dev browser / browser print mode): print the CSS label instead.
			const result = await printKioskQrLabels(
				[
					{
						qrSrc: qrImage.src,
						name: registration.label.name,
						emergencyPhone: registration.label.emergency_phone,
						checkedCount: KIOSK_CHECK_IN_TICKS
					}
				],
				async () => {
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					window.print();
				},
				languageStore.current
			);
			if (result.kind === 'printed') {
				printPhase = 'done';
				doneTimer = setTimeout(() => {
					if (printPhase === 'done') printPhase = 'idle';
				}, PRINT_DONE_VISIBLE_MS);
				return;
			}
			printPhase = 'idle';
			if (result.kind === 'error') printError = result.message;
		} catch {
			printPhase = 'idle';
			printError = t.printRenderFailed;
		} finally {
			idleTimeout.setPaused(false);
		}
	}
</script>

<svelte:head><title>{t.pageTitle}</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3">
	<KioskCheckInWizard currentStep={5} step2Label={t.wizardStep} />
	<KioskNoticePanel
		tone="success"
		icon={CheckCircle2}
		title={t.title}
		headingTag="h1"
		role="status"
	>
		{#if registration}
			<p>
				{viaThaid ? t.takeQrThaid : t.takeQrCard}
			</p>
			<p class="text-base kiosk-portrait:text-xl">
				{t.consentRef}:
				<span class="font-mono tracking-wide">{registration.consent_ref}</span>
			</p>
			{#if printError}
				<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert"
					>{t.printFailedHint(printError)}</KioskInlineAlert
				>
			{/if}
		{:else}
			{#if !viaThaid}<p>{t.removeCard}</p>{/if}
			<p>{t.contactStaff}</p>
		{/if}
		{#snippet actions()}
			{#if registration}
				<Button
					type="button"
					variant="outline"
					onclick={printLabel}
					disabled={printPhase === 'printing'}
					class={KIOSK_NOTICE_SECONDARY_ACTION}><Printer aria-hidden="true" />{t.printAgain}</Button
				>
			{/if}
			<Button type="button" onclick={returnHome} class={KIOSK_NOTICE_PRIMARY_ACTION}
				>{t.home}</Button
			>
		{/snippet}
	</KioskNoticePanel>
</div>
{#if registration}
	<KioskLabelSheet {labels} />
{/if}
{#if printPhase !== 'idle'}
	<KioskPrintStatus phase={printPhase} count={1} />
{/if}
