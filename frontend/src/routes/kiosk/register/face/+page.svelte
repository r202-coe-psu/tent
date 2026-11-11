<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import {
		abandonWalkIn,
		buildKioskContextQuery,
		cancelKioskFaceCheck,
		KioskBackButton,
		KioskCheckInWizard,
		KioskFaceCheck,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInSession,
		type FaceCheckOutcome
	} from '$lib/features/kiosk';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_REGISTER_FACE_I18N } from './face-page.i18n';

	const contextQuery = $derived(
		buildKioskContextQuery(readKioskDisplayQuery(page.url.searchParams))
	);
	const homeUrl = $derived(`/kiosk${contextQuery}`);
	const t = $derived(getTranslation(KIOSK_REGISTER_FACE_I18N, languageStore.current));
	const faceCheck = walkInSession.faceCheckToRun;
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	/** Going on to the phone step; any other way off this page abandons the walk-in. */
	let continuing = false;

	onMount(() => {
		if (walkInSession.source !== 'smart-card' || !walkInSession.identityReady) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		return () => {
			idleTimeout.stop();
			// However the person leaves (cancel, idle, on to the phone), do not leave the check behind.
			void cancelKioskFaceCheck();
			if (!continuing && walkInSession.active) abandonWalkIn();
		};
	});

	function activity() {
		idleTimeout.recordActivity();
	}

	function handleFaceBusyChange(busy: boolean) {
		idleTimeout.setPaused(busy);
	}

	function returnHome() {
		abandonWalkIn();
		navigateToKioskHome(contextQuery);
	}

	/**
	 * Only a match or a staff PIN bypass gets here (anything else waits for the PIN, or "cancel" /
	 * taking the card out on the PIN goes home without registering). The phone step registers.
	 */
	function handleFaceFinished(outcome: FaceCheckOutcome) {
		walkInSession.faceOutcome = outcome;
		continuing = true;
		void goto(resolve(`/kiosk/register/phone${contextQuery}`));
	}
</script>

<svelte:head><title>{t.pageTitle}</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3 kiosk-compact:gap-1.5 kiosk-compact:py-0"
>
	<KioskCheckInWizard currentStep={3} step2Label={t.wizardStep} />
	<!-- Leaving mid-check is a cancel: unmounting ends the check and nothing is registered. -->
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} onclick={() => abandonWalkIn()} />
	</div>
	{#if walkInSession.citizenId && walkInSession.identityReady}
		<KioskFaceCheck
			flow="walk_in"
			citizenId={walkInSession.citizenId}
			cameraLabel={faceCheck.cameraLabel}
			cameraFlip={faceCheck.cameraFlip}
			onfinish={handleFaceFinished}
			oncancel={returnHome}
			onbusychange={handleFaceBusyChange}
		/>
	{/if}
</div>
