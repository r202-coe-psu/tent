<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskCheckInWizard,
		KioskRegisterConsent,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInSession
	} from '$lib/features/kiosk';
	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	onMount(() => {
		if (!walkInSession.citizenId) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		return () => idleTimeout.stop();
	});
	function activity() {
		idleTimeout.recordActivity();
	}
	function returnHome() {
		walkInSession.clear();
		navigateToKioskHome(contextQuery);
	}
	function consent() {
		walkInSession.consent();
		void goto(
			resolve(
				`/kiosk/register/card${contextQuery}` as
					'/kiosk/register/card' | `/kiosk/register/card?${string}`
			)
		);
	}
</script>

<svelte:head><title>ยินยอมลงทะเบียน — SmartShelter Kiosk</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3">
	<KioskCheckInWizard currentStep={2} step2Label="ยินยอม" />
	<KioskRegisterConsent onconsent={consent} oncancel={returnHome} />
</div>
