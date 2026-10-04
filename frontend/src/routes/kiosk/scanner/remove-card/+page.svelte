<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import {
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskPreRegisteredCheckIn,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInSession,
		type GateInput
	} from '$lib/features/kiosk';

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	let gate = $state<GateInput | null>(null);
	let ready = $state(false);
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);

	$effect(() => {
		if (!gate) return;
		untrack(() => idleTimeout.start());
		return () => idleTimeout.stop();
	});

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}

	function handlePrintBusyChange(busy: boolean): void {
		idleTimeout.setPaused(busy);
	}

	function returnHome(): void {
		navigateToKioskHome(contextQuery);
	}

	function startWalkInRegistration(citizenId: string): void {
		walkInSession.begin(citizenId);
		void goto(
			resolve(
				`/kiosk/register/consent${contextQuery}` as
					'/kiosk/register/consent' | `/kiosk/register/consent?${string}`
			)
		);
	}

	function cardEventAttachment() {
		const handleCardRead = (event: Event) => {
			const detail = (event as CustomEvent<{ citizenId?: unknown }>).detail;
			if (typeof detail?.citizenId !== 'string' || !/^\d{13}$/.test(detail.citizenId)) return;
			gate = { source: 'smart-card', citizen_id: detail.citizenId };
		};
		window.addEventListener('kiosk:smart-card-read', handleCardRead);
		ready = true;
		return () => {
			window.removeEventListener('kiosk:smart-card-read', handleCardRead);
		};
	}
</script>

<svelte:head><title>รายงานตัวด้วยบัตรประชาชน — SmartShelter Kiosk</title></svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

<div {@attach cardEventAttachment} data-kiosk-card-ready={ready ? 'true' : undefined}>
	<KioskPreRegisteredCheckIn
		input={gate}
		{contextQuery}
		displayShelterCode={displayContext.shelterCode}
		cardMode
		onprintbusychange={handlePrintBusyChange}
		onreset={returnHome}
		onregister={startWalkInRegistration}
	/>
</div>
