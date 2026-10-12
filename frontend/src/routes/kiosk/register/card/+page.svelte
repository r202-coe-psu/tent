<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		abandonWalkIn,
		buildKioskContextQuery,
		cancelKioskFaceCheck,
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KIOSK_NOTICE_SECONDARY_ACTION,
		KioskBackButton,
		KioskBusyStatus,
		KioskCheckInWizard,
		KioskInlineAlert,
		KioskNoticePanel,
		isFaceCheckEnabled,
		loadKioskHardware,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInCardMismatch,
		walkInSession,
		type KioskHardware
	} from '$lib/features/kiosk';
	import type { SmartCardData } from '$lib/features/scanners';
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	const homeUrl = $derived(`/kiosk${contextQuery}`);
	let ready = $state(false);
	/** kiosk is reading the chip; pulling the card now loses the photo. */
	let cardReading = $state(false);
	/** The read is in: waiting for the hardware answer before moving on. */
	let reading = $state(false);
	let error = $state('');
	/** Going on to the next walk-in step; any other way off this page abandons the walk-in. */
	let continuing = false;
	// Null until the scanner client answers; a card read that beats it waits for the answer (FR-17).
	let hardware = $state<KioskHardware | null>(null);
	let hardwareLoaded: Promise<KioskHardware> | null = null;
	const busy = $derived(cardReading || reading);
	// Paused while the chip is read or the card is saved: neither may be cut short by going home.
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	onMount(() => {
		if (
			walkInSession.source !== 'smart-card' ||
			!walkInSession.citizenId ||
			!walkInSession.consented
		) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		hardwareLoaded = loadKioskHardware().then((loaded) => (hardware = loaded));
		const onCardReading = () => {
			cardReading = true;
			error = '';
			idleTimeout.setPaused(true);
		};
		const onCardRead = (event: Event) => void handleFullRead(event);
		const onCardReadError = () => {
			cardReading = false;
			reading = false;
			idleTimeout.setPaused(false);
			error = 'อ่านข้อมูลบัตรไม่สำเร็จ กรุณานำบัตรออกแล้วเสียบใหม่';
		};
		window.addEventListener('kiosk:smart-card-reading', onCardReading);
		window.addEventListener('kiosk:smart-card-full-read', onCardRead);
		window.addEventListener('kiosk:smart-card-full-read-error', onCardReadError);
		ready = true;
		return () => {
			idleTimeout.stop();
			if (!continuing && walkInSession.active) leave();
			ready = false;
			window.removeEventListener('kiosk:smart-card-reading', onCardReading);
			window.removeEventListener('kiosk:smart-card-full-read', onCardRead);
			window.removeEventListener('kiosk:smart-card-full-read-error', onCardReadError);
		};
	});
	function activity() {
		idleTimeout.recordActivity();
	}
	/** Every way home ends the visit; the back button's link does the navigating itself. */
	function leave() {
		// The chip photo may be set aside on the scanner client for the face check.
		if (hardware && isFaceCheckEnabled(hardware.faceCheck, 'walk_in')) void cancelKioskFaceCheck();
		abandonWalkIn();
	}
	function returnHome() {
		leave();
		navigateToKioskHome(contextQuery);
	}
	async function handleFullRead(event: Event) {
		if (reading) return;
		const card = (event as CustomEvent<SmartCardData>).detail;
		cardReading = false;
		if (!card || typeof card.citizen_id !== 'string') {
			idleTimeout.setPaused(false);
			return;
		}
		const mismatch = walkInCardMismatch(card, walkInSession);
		if (mismatch) {
			error = mismatch;
			idleTimeout.setPaused(false);
			return;
		}
		reading = true;
		idleTimeout.setPaused(true);
		error = '';
		const resolved = hardware ?? (await hardwareLoaded);
		const faceCheckOn = Boolean(resolved && isFaceCheckEnabled(resolved.faceCheck, 'walk_in'));
		// Hold the card in memory; the phone step registers it at the end. The face check found on
		// here goes with it, so the face page never has to ask again (and fail open).
		walkInSession.holdCard(
			card,
			faceCheckOn && resolved
				? { cameraLabel: resolved.cameraLabel, cameraFlip: resolved.cameraFlip }
				: null
		);
		continuing = true;
		await goto(
			resolve(
				faceCheckOn ? `/kiosk/register/face${contextQuery}` : `/kiosk/register/phone${contextQuery}`
			)
		);
	}
</script>

<svelte:head><title>เสียบบัตรประชาชน — SmartShelter Kiosk</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3"
	data-kiosk-register-ready={ready ? 'true' : 'false'}
>
	<KioskCheckInWizard currentStep={3} step2Label="อ่านบัตร" />
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} onclick={leave} disabled={busy} />
	</div>
	<KioskNoticePanel
		tone="info"
		icon={CreditCard}
		headingTag="h1"
		title={busy ? 'กำลังอ่านข้อมูลบัตร' : 'เสียบบัตรประชาชน'}
	>
		{#if busy}
			<KioskBusyStatus data-testid="kiosk-register-card-busy">กรุณารอสักครู่</KioskBusyStatus>
			{#if cardReading}
				<KioskInlineAlert tone="warning" icon={CircleAlert}
					>อย่าดึงบัตรออก จนกว่าระบบจะอ่านเสร็จ</KioskInlineAlert
				>
			{/if}
		{:else}
			<p>
				เสียบบัตรของผู้ที่ต้องการลงทะเบียน (หากเสียบค้างอยู่แล้ว ไม่ต้องถอด)
				ระบบจะอ่านข้อมูลจากชิปโดยอัตโนมัติ
			</p>
		{/if}
		{#if error}
			<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert">{error}</KioskInlineAlert>
		{/if}
		{#snippet actions()}
			<Button
				type="button"
				variant="outline"
				onclick={returnHome}
				disabled={busy}
				class={KIOSK_NOTICE_SECONDARY_ACTION}>ยกเลิก</Button
			>
		{/snippet}
	</KioskNoticePanel>
</div>
