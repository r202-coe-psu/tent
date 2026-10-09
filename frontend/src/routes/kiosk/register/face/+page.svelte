<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		buildKioskContextQuery,
		cancelKioskFaceCheck,
		getKioskDisplayContext,
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION,
		KioskBackButton,
		KioskBusyStatus,
		KioskCheckInWizard,
		KioskNoticePanel,
		KioskFaceCheck,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		navigateToKioskHome,
		readKioskDisplayQuery,
		submitWalkInCard,
		walkInSession,
		type FaceCheckOutcome
	} from '$lib/features/kiosk';

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	const homeUrl = $derived(`/kiosk${contextQuery}`);
	let registering = $state(false);
	let error = $state('');
	const faceCheck = walkInSession.faceCheckToRun;
	let faceBusy = false;
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);

	onMount(() => {
		if (!walkInSession.citizenId || !walkInSession.consented || !walkInSession.card) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		return () => {
			idleTimeout.stop();
			// However the person leaves (cancel, idle, registered), do not leave the check behind.
			void cancelKioskFaceCheck();
		};
	});

	function activity() {
		idleTimeout.recordActivity();
	}

	function syncIdlePause() {
		idleTimeout.setPaused(faceBusy || registering);
	}

	function handleFaceBusyChange(busy: boolean) {
		faceBusy = busy;
		syncIdlePause();
	}

	function returnHome() {
		walkInSession.clear();
		navigateToKioskHome(contextQuery);
	}

	/**
	 * Mode `on`: only a match or a staff PIN bypass gets here (anything else waits for the PIN, or
	 * "cancel" goes home without registering). Shadow: every ending, as before.
	 */
	function handleFaceFinished(outcome: FaceCheckOutcome) {
		walkInSession.faceOutcome = outcome;
		void register();
	}

	async function register() {
		if (registering) return;
		registering = true;
		syncIdlePause();
		error = '';
		const outcome = await submitWalkInCard(walkInSession.card, walkInSession);
		if (outcome.kind === 'registered') {
			walkInSession.clear();
			await goto(
				resolve(
					`/kiosk/register/done${contextQuery}` as
						'/kiosk/register/done' | `/kiosk/register/done?${string}`
				)
			);
			return;
		}
		error =
			outcome.kind === 'mismatch' || outcome.kind === 'error'
				? outcome.message
				: 'ลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง';
		registering = false;
		syncIdlePause();
	}
</script>

<svelte:head><title>ตรวจสอบใบหน้า — SmartShelter Kiosk</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3 kiosk-compact:gap-1.5 kiosk-compact:py-0"
>
	<KioskCheckInWizard currentStep={3} step2Label="อ่านบัตร" />
	<!-- Leaving mid-check is a cancel: unmounting ends the check and nothing is registered. -->
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} onclick={() => walkInSession.clear()} disabled={registering} />
	</div>
	{#if error}
		<KioskNoticePanel
			tone="warning"
			icon={CircleAlert}
			headingTag="h1"
			title="ลงทะเบียนไม่สำเร็จ"
			role="alert"
		>
			<p>{error}</p>
			{#snippet actions()}
				<Button type="button" onclick={register} class={KIOSK_NOTICE_PRIMARY_ACTION}
					>ลองอีกครั้ง</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={returnHome}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>ยกเลิก</Button
				>
			{/snippet}
		</KioskNoticePanel>
	{:else if registering}
		<KioskNoticePanel tone="info" icon={UserPlus} headingTag="h1" title="กำลังบันทึกข้อมูล">
			<KioskBusyStatus>กรุณารอสักครู่</KioskBusyStatus>
		</KioskNoticePanel>
	{:else if walkInSession.citizenId && walkInSession.consented && walkInSession.card}
		<KioskFaceCheck
			flow="walk_in"
			citizenId={walkInSession.citizenId}
			cameraLabel={faceCheck.cameraLabel}
			onfinish={handleFaceFinished}
			oncancel={returnHome}
			onbusychange={handleFaceBusyChange}
		/>
	{/if}
</div>
