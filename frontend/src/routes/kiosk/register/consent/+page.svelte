<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { ConsentDecision } from '$lib/features/consent';
	import {
		abandonWalkIn,
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskBackButton,
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
	const homeUrl = $derived(`/kiosk${contextQuery}`);
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);
	/** Going on to the next walk-in step; any other way off this page abandons the walk-in. */
	let continuing = false;
	onMount(() => {
		if (!walkInSession.active) {
			void goto(resolve(`/kiosk${contextQuery}` as '/kiosk' | `/kiosk?${string}`));
			return;
		}
		idleTimeout.start();
		return () => {
			idleTimeout.stop();
			if (!continuing && walkInSession.active) abandonWalkIn();
		};
	});
	function activity() {
		idleTimeout.recordActivity();
	}
	function returnHome() {
		abandonWalkIn();
		navigateToKioskHome(contextQuery);
	}
	function consent(decision: ConsentDecision) {
		walkInSession.recordConsent(decision);
		continuing = true;
		// ThaiD has proved who they are already: straight on to the phone. A card is read next.
		void goto(
			resolve(
				walkInSession.source === 'thaid'
					? `/kiosk/register/phone${contextQuery}`
					: `/kiosk/register/card${contextQuery}`
			)
		);
	}
</script>

<svelte:head><title>ยินยอมลงทะเบียน — SmartShelter Kiosk</title></svelte:head>
<svelte:window onpointerdown={activity} onkeydown={activity} />
<div
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3 kiosk-compact:gap-1.5 kiosk-compact:py-0"
>
	<KioskCheckInWizard currentStep={2} step2Label="ยินยอม" />
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} onclick={() => abandonWalkIn()} />
	</div>
	<KioskRegisterConsent
		source={walkInSession.source === 'thaid' ? 'thaid' : 'smart-card'}
		onconsent={consent}
		oncancel={returnHome}
	/>
</div>
