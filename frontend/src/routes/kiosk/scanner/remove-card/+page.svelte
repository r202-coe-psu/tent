<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import {
		buildKioskContextQuery,
		cancelKioskFaceCheck,
		getKioskDisplayContext,
		isFaceCheckEnabled,
		KioskFaceCheck,
		KioskIdleTimeout,
		KIOSK_IDLE_TIMEOUT_MS,
		KioskPreRegisteredCheckIn,
		loadKioskHardware,
		navigateToKioskHome,
		readKioskDisplayQuery,
		walkInSession,
		type GateInput,
		type KioskHardware
	} from '$lib/features/kiosk';

	const displayContext = $derived(
		getKioskDisplayContext(readKioskDisplayQuery(page.url.searchParams))
	);
	const contextQuery = $derived(buildKioskContextQuery(displayContext));
	let gate = $state<GateInput | null>(null);
	let ready = $state(false);
	// Null until the scanner client has answered; the member list waits for it (see holdMembers).
	let hardware = $state<KioskHardware | null>(null);
	/** The citizen ID whose face check has ended, so a new card asks again. */
	let faceDoneFor = $state<string | null>(null);
	const faceMode = $derived(
		hardware &&
			isFaceCheckEnabled(hardware.faceCheck, 'check_in') &&
			hardware.faceCheck.mode !== 'off'
			? hardware.faceCheck.mode
			: null
	);
	const holdMembers = $derived(
		gate?.source === 'smart-card' &&
			(hardware === null || (faceMode !== null && faceDoneFor !== gate.citizen_id))
	);
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
		void loadKioskHardware().then((loaded) => (hardware = loaded));
		const handleCardRead = (event: Event) => {
			const detail = (event as CustomEvent<{ citizenId?: unknown }>).detail;
			if (typeof detail?.citizenId !== 'string' || !/^\d{13}$/.test(detail.citizenId)) return;
			gate = { source: 'smart-card', citizen_id: detail.citizenId };
		};
		window.addEventListener('kiosk:smart-card-read', handleCardRead);
		ready = true;
		return () => {
			window.removeEventListener('kiosk:smart-card-read', handleCardRead);
			// Leaving ends this person's visit: wipe the face check the scanner client may still hold.
			if (faceMode !== null) void cancelKioskFaceCheck();
		};
	}
</script>

<svelte:head><title>รายงานตัวด้วยบัตรประชาชน — SmartShelter Kiosk</title></svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

{#snippet faceStep()}
	{#if faceMode && gate?.source === 'smart-card'}
		{@const citizenId = gate.citizen_id}
		<KioskFaceCheck
			flow="check_in"
			{citizenId}
			mode={faceMode}
			cameraLabel={hardware?.cameraLabel ?? null}
			embedded
			onfinish={() => (faceDoneFor = citizenId)}
			onbusychange={handlePrintBusyChange}
		/>
	{/if}
{/snippet}

<div {@attach cardEventAttachment} data-kiosk-card-ready={ready ? 'true' : undefined}>
	<KioskPreRegisteredCheckIn
		input={gate}
		{contextQuery}
		displayShelterCode={displayContext.shelterCode}
		cardMode
		onprintbusychange={handlePrintBusyChange}
		onreset={returnHome}
		onregister={startWalkInRegistration}
		{holdMembers}
		hold={faceStep}
	/>
</div>
