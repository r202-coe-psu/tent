<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import IdCard from '@lucide/svelte/icons/id-card';
	import UserRoundSearch from '@lucide/svelte/icons/user-round-search';
	import UserRoundX from '@lucide/svelte/icons/user-round-x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { createBusyReport } from '../application/busy-report';
	import { openFaceCamera } from '../application/face-camera';
	import { FaceCheckSession } from '../application/face-check-session.svelte';
	import { createKioskFaceApi } from '../data/kiosk-face.api';
	import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
	import {
		FACE_BYPASSED_BY_STAFF,
		FACE_MATCH_SHOWN_MS,
		faceOutcomeAction,
		faceOutcomeMessage,
		staffPinCancelAction,
		type FaceCheckFlow,
		type FaceCheckOutcome,
		type StaffPinOpenedFrom
	} from '../domain/face-check';
	import KioskBiometricConsent from './kiosk-biometric-consent.svelte';
	import KioskFaceCameraPanel from './kiosk-face-camera-panel.svelte';
	import KioskFaceCardNotice from './kiosk-face-card-notice.svelte';
	import KioskStaffPinEntry from './kiosk-staff-pin-entry.svelte';

	interface Props {
		flow: FaceCheckFlow;
		citizenId: string;
		/** shadow: runs the check but never shows the person a result. on: shows it. */
		mode: 'shadow' | 'on';
		/** Which of the kiosk's cameras to use (same label as the QR camera); null = front camera. */
		cameraLabel: string | null;
		/**
		 * The person may move on: a match, staff entered the PIN (`skipped / staff_bypass`), or in
		 * shadow mode any ending. In mode `on` nothing else gets here.
		 */
		onfinish: (outcome: FaceCheckOutcome) => void;
		/** Mode `on`, after an ending that needs the PIN: "cancel" pressed. Go home, save nothing. */
		oncancel: () => void;
		/** True while the camera runs or the staff PIN panel is open, so the page can pause its idle timeout. */
		onbusychange?: (busy: boolean) => void;
		/** The page already has an h1 (the check-in header): headings here become h2. */
		embedded?: boolean;
		/** Checks the staff PIN; replaced in tests. */
		verifyStaffPin?: (pin: string) => Promise<KioskStaffPinResult>;
	}

	let {
		flow,
		citizenId,
		mode,
		cameraLabel,
		onfinish,
		oncancel,
		onbusychange,
		embedded = false,
		verifyStaffPin
	}: Props = $props();
	const headingTag = $derived(embedded ? 'h2' : 'h1');

	let video = $state<HTMLVideoElement>();
	let skipButton = $state<HTMLElement | null>(null);
	/**
	 * Where the staff PIN panel was opened from: the camera (cancel resumes the check) or the result
	 * screen after the check ended (cancel goes home). Closed = null.
	 */
	let pinFrom = $state<StaffPinOpenedFrom | null>(null);
	/** "Staff carry on" on the result screen; focus returns here when the PIN is cancelled. */
	let continueButton = $state<HTMLElement | null>(null);
	/** onfinish has been called: nothing more to show while the page moves on. */
	let handedOn = $state(false);
	let matchTimer: ReturnType<typeof setTimeout> | null = null;
	let sessionBusy = false;
	const busyReport = createBusyReport((busy) => onbusychange?.(busy));
	const faceApi = createKioskFaceApi();

	const session = untrack(
		() =>
			new FaceCheckSession({
				flow,
				citizenId,
				api: faceApi,
				openCamera: () => openFaceCamera(video!, cameraLabel),
				onfinish: handleFinished,
				onbusychange: (busy) => {
					sessionBusy = busy;
					reportBusy();
				}
			})
	);

	const pinOpen = $derived(pinFrom !== null);
	const cameraShown = $derived(
		!pinOpen &&
			(session.phase === 'starting' ||
				session.phase === 'positioning' ||
				session.phase === 'verifying')
	);
	const finished = $derived(
		session.phase === 'done' && mode === 'on' && session.outcome !== null && !handedOn
	);
	const notMatched = $derived(
		finished && session.outcome !== null && session.outcome.kind !== 'match'
			? session.outcome
			: null
	);
	const notMatchedMessage = $derived(notMatched ? faceOutcomeMessage(notMatched) : null);
	// Check-in reads the chip photo during the check, so the card must stay in until it says so.
	const cardNoticeShown = $derived(flow === 'check_in' && session.phase !== 'done');

	/** The page's idle timeout pauses while the camera runs and while staff are on the PIN. */
	function reportBusy(): void {
		busyReport.update(sessionBusy || pinFrom !== null);
	}

	function setPinFrom(from: StaffPinOpenedFrom | null): void {
		pinFrom = from;
		reportBusy();
	}

	function handOn(outcome: FaceCheckOutcome): void {
		handedOn = true;
		setPinFrom(null);
		onfinish(outcome);
	}

	/** In mode `on` only a match or a staff bypass carries on (`faceOutcomeAction`). */
	function handleFinished(outcome: FaceCheckOutcome): void {
		switch (faceOutcomeAction(outcome, mode)) {
			case 'hand_on':
				return handOn(outcome);
			case 'show_match':
				setPinFrom(null);
				matchTimer = setTimeout(() => handOn(outcome), FACE_MATCH_SHOWN_MS);
				return;
			case 'close_pin':
				setPinFrom(null);
				return;
			case 'wait_for_pin':
				// The PIN panel, if open, stays open; otherwise the result screen asks.
				return;
		}
	}

	/** "Staff skip this step" at the camera. Shadow mode never shows a result, so it never asks. */
	function handleSkip(): void {
		if (mode === 'shadow') return session.skip();
		session.hold();
		setPinFrom('camera');
	}

	function handlePinVerified(): void {
		if (session.phase !== 'done') {
			// Ends the check as a staff bypass; handleFinished hands it on.
			session.skip(FACE_BYPASSED_BY_STAFF);
			return;
		}
		// The check had already ended: only the scanner client's log learns why it carried on.
		void faceApi.cancel(FACE_BYPASSED_BY_STAFF);
		handOn({ kind: 'skipped', reason: FACE_BYPASSED_BY_STAFF });
	}

	async function handlePinCancel(): Promise<void> {
		const from = pinFrom;
		if (!from) return;
		setPinFrom(null);
		switch (staffPinCancelAction(from, session.phase === 'done')) {
			case 'go_home':
				return oncancel();
			case 'show_result':
				// Ended meanwhile: the result screen asks again.
				await tick();
				continueButton?.focus();
				return;
			case 'resume':
				session.resume();
				await tick();
				skipButton?.focus();
		}
	}

	/**
	 * The scanner client says when the card comes out. Only matters while staff are on the PIN from
	 * the camera: the session ends as `card_removed` if the chip photo was still needed.
	 */
	function listenForCardRemoval(): () => void {
		const handleCardRemoved = () => {
			if (flow === 'check_in' && pinFrom === 'camera') void session.cardRemoved();
		};
		window.addEventListener('kiosk:smart-card-removed', handleCardRemoved);
		return () => window.removeEventListener('kiosk:smart-card-removed', handleCardRemoved);
	}

	onMount(() => () => {
		if (matchTimer) clearTimeout(matchTimer);
		session.destroy();
		// Unmounted mid-check or with the PIN panel open: never leave the page's idle timeout paused.
		busyReport.release();
	});
</script>

<section
	class="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8 kiosk-compact:mt-2 kiosk-compact:p-3"
	aria-live="polite"
	data-testid="kiosk-face-check"
	data-face-phase={session.phase}
	{@attach listenForCardRemoval}
>
	{#if cardNoticeShown}
		<KioskFaceCardNotice removable={session.cardRemovable} />
	{/if}

	{#if session.phase === 'consent'}
		<KioskBiometricConsent
			{headingTag}
			onagree={() => void session.agree()}
			ondecline={() => session.decline()}
		/>
	{/if}

	<!-- Always mounted: the camera opens into it before the next render could mount it. -->
	<KioskFaceCameraPanel
		bind:video
		bind:skipButton
		{headingTag}
		shown={cameraShown}
		starting={session.phase === 'starting'}
		verifying={session.phase === 'verifying'}
		message={session.message}
		attempt={session.attempt}
		maxAttempts={session.maxAttempts}
		slow={session.slow}
		frameReady={session.frameReady}
		framingProblem={session.framingProblem}
		showSkip={session.busy}
		onskip={handleSkip}
	/>

	{#if pinOpen}
		<KioskStaffPinEntry
			{headingTag}
			verify={verifyStaffPin}
			onverified={handlePinVerified}
			oncancel={() => void handlePinCancel()}
		/>
	{:else if finished && session.outcome?.kind === 'match'}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-950"
			role="status"
			data-testid="kiosk-face-result"
			data-face-result="match"
		>
			<CheckCircle2 class="size-12 kiosk-portrait:size-20" aria-hidden="true" />
			<svelte:element this={headingTag} class="text-2xl font-bold kiosk-portrait:text-4xl"
				>ยืนยันตัวตนเรียบร้อย</svelte:element
			>
		</div>
	{:else if notMatchedMessage}
		<!-- Never red and never "refused": the threshold can be wrong and this may be the card's owner. -->
		<div
			class={[
				'flex flex-col items-center gap-3 rounded-xl border p-6 text-center',
				notMatchedMessage.tone === 'declined'
					? 'border-sky-200 bg-sky-50 text-sky-950'
					: 'border-amber-200 bg-amber-50 text-amber-950'
			]}
			role="status"
			data-testid="kiosk-face-result"
			data-face-result={notMatchedMessage.tone}
		>
			{#if notMatchedMessage.tone === 'not_confirmed'}
				<UserRoundX class="size-12 kiosk-portrait:size-20" aria-hidden="true" />
			{:else if notMatchedMessage.tone === 'declined'}
				<IdCard class="size-12 kiosk-portrait:size-20" aria-hidden="true" />
			{:else}
				<UserRoundSearch class="size-12 kiosk-portrait:size-20" aria-hidden="true" />
			{/if}
			<svelte:element this={headingTag} class="text-2xl font-bold kiosk-portrait:text-4xl"
				>{notMatchedMessage.title}</svelte:element
			>
			<p class="text-lg kiosk-portrait:text-2xl">{notMatchedMessage.detail}</p>
			<div class="mt-2 flex w-full max-w-md flex-col gap-3 kiosk-portrait:max-w-xl">
				<Button
					bind:ref={continueButton}
					type="button"
					onclick={() => setPinFrom('result')}
					class="min-h-12 w-full bg-[#0A2647] px-8 text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-2xl"
					>เจ้าหน้าที่ดำเนินการต่อ</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={oncancel}
					class="min-h-12 w-full px-8 text-base font-bold focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-2xl"
					>ยกเลิก</Button
				>
			</div>
		</div>
	{/if}
</section>
