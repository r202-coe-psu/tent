<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
		type FaceCheckOutcome,
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
	/**
	 * Mode `on`, face matched: the chip photo the scanner client handed over, for /check-in to keep
	 * as the card owner's photo if they have none. Never after a staff PIN bypass; dropped on a new
	 * card or when the page goes.
	 */
	let chipPhoto = $state.raw<{ citizenId: string; photo: string } | null>(null);
	const cardPhoto = $derived(
		gate?.source === 'smart-card' && chipPhoto?.citizenId === gate.citizen_id
			? chipPhoto.photo
			: null
	);
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
	/** Camera running or staff on the PIN panel (which has its own 30 s idle). */
	let faceBusy = false;
	let printBusy = false;
	/** Counts from each card: the household list (or a "not matched" result) must not stay up. */
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}

	function syncIdlePause(): void {
		idleTimeout.setPaused(faceBusy || printBusy);
	}

	function handleFaceBusyChange(busy: boolean): void {
		faceBusy = busy;
		syncIdlePause();
	}

	function handlePrintBusyChange(busy: boolean): void {
		printBusy = busy;
		syncIdlePause();
	}

	function returnHome(): void {
		chipPhoto = null;
		navigateToKioskHome(contextQuery);
	}

	function handleFaceFinished(citizenId: string, outcome: FaceCheckOutcome): void {
		faceDoneFor = citizenId;
		chipPhoto =
			faceMode === 'on' && outcome.kind === 'match' && outcome.chipPhoto
				? { citizenId, photo: outcome.chipPhoto }
				: null;
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
			chipPhoto = null; // a new card is a new person
			gate = { source: 'smart-card', citizen_id: detail.citizenId };
			idleTimeout.start();
		};
		window.addEventListener('kiosk:smart-card-read', handleCardRead);
		ready = true;
		return () => {
			idleTimeout.stop();
			window.removeEventListener('kiosk:smart-card-read', handleCardRead);
			chipPhoto = null;
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
			onfinish={(outcome) => handleFaceFinished(citizenId, outcome)}
			oncancel={returnHome}
			onbusychange={handleFaceBusyChange}
		/>
	{/if}
{/snippet}

<div {@attach cardEventAttachment} data-kiosk-card-ready={ready ? 'true' : undefined}>
	<KioskPreRegisteredCheckIn
		input={gate}
		{contextQuery}
		displayShelterCode={displayContext.shelterCode}
		cardMode
		{cardPhoto}
		onprintbusychange={handlePrintBusyChange}
		onreset={returnHome}
		onregister={startWalkInRegistration}
		{holdMembers}
		hold={faceStep}
	/>
</div>
