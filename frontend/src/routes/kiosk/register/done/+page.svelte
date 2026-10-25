<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Printer from '@lucide/svelte/icons/printer';
	import { Button } from '$lib/components/ui/button/index.js';
	import { CONSENT_COPY } from '$lib/features/consent';
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
						checkedCount: KIOSK_CHECK_IN_TICKS
					}
				],
				async () => {
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					window.print();
				}
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
			printError = 'สร้าง QR Code สำหรับพิมพ์ไม่สำเร็จ';
		} finally {
			idleTimeout.setPaused(false);
		}
	}
</script>

<svelte:head><title>ลงทะเบียนสำเร็จ — SmartShelter Kiosk</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3">
	<KioskCheckInWizard currentStep={5} step2Label="ลงทะเบียน" />
	<KioskNoticePanel
		tone="success"
		icon={CheckCircle2}
		title="ลงทะเบียนสำเร็จ"
		headingTag="h1"
		role="status"
	>
		{#if registration}
			<p>
				{viaThaid
					? 'รับ QR Code แล้วไปที่จุดคัดกรอง'
					: 'กรุณานำบัตรออกจากเครื่อง รับ QR Code แล้วไปที่จุดคัดกรอง'}
			</p>
			<p class="text-base kiosk-portrait:text-xl">
				{CONSENT_COPY.summary.mode}: {registration.consent_mode === 'basic'
					? CONSENT_COPY.summary.modeBasic
					: CONSENT_COPY.summary.modeFull}
				<br />
				{CONSENT_COPY.summary.ref}:
				<span class="font-mono tracking-wide">{registration.consent_ref}</span>
			</p>
			{#if printError}
				<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert"
					>{printError} กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่</KioskInlineAlert
				>
			{/if}
		{:else}
			{#if !viaThaid}<p>กรุณานำบัตรออกจากเครื่อง</p>{/if}
			<p>กรุณาติดต่อเจ้าหน้าที่เพื่อพิมพ์ QR Code</p>
		{/if}
		{#snippet actions()}
			{#if registration}
				<Button
					type="button"
					variant="outline"
					onclick={printLabel}
					disabled={printPhase === 'printing'}
					class={KIOSK_NOTICE_SECONDARY_ACTION}><Printer aria-hidden="true" />พิมพ์อีกครั้ง</Button
				>
			{/if}
			<Button type="button" onclick={returnHome} class={KIOSK_NOTICE_PRIMARY_ACTION}
				>กลับหน้าแรก</Button
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
