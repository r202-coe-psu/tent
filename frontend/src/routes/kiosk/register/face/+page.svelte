<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		buildKioskContextQuery,
		cancelKioskFaceCheck,
		getKioskDisplayContext,
		KioskCheckInWizard,
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
<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 py-3">
	<KioskCheckInWizard currentStep={3} step2Label="อ่านบัตร" />
	{#if error}
		<section
			class="mx-auto mt-4 w-full max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
			role="alert"
		>
			<div class="flex gap-3">
				<CircleAlert class="size-6 shrink-0" aria-hidden="true" />
				<p class="text-lg font-semibold">{error}</p>
			</div>
			<div class="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				<Button type="button" variant="outline" onclick={returnHome} class="min-h-12 px-6"
					>ยกเลิก</Button
				>
				<Button
					type="button"
					onclick={register}
					class="min-h-12 bg-[#0A2647] px-6 font-bold text-white hover:bg-[#051930]"
					>ลองอีกครั้ง</Button
				>
			</div>
		</section>
	{:else if registering}
		<p class="mt-8 text-center text-xl font-bold text-slate-900" role="status">
			กำลังบันทึกข้อมูล…
		</p>
	{:else if walkInSession.citizenId && walkInSession.consented && walkInSession.card}
		<KioskFaceCheck
			flow="walk_in"
			citizenId={walkInSession.citizenId}
			mode={faceCheck.mode}
			cameraLabel={faceCheck.cameraLabel}
			onfinish={handleFaceFinished}
			oncancel={returnHome}
			onbusychange={handleFaceBusyChange}
		/>
	{/if}
</div>
