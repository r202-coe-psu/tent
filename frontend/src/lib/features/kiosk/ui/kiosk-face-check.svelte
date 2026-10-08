<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import IdCard from '@lucide/svelte/icons/id-card';
	import UserRoundSearch from '@lucide/svelte/icons/user-round-search';
	import UserRoundX from '@lucide/svelte/icons/user-round-x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { createBusyReport } from '../application/busy-report';
	import { openFaceCamera } from '../application/face-camera';
	import { FaceCheckPinFlow } from '../application/face-check-pin-flow.svelte';
	import { FaceCheckSession } from '../application/face-check-session.svelte';
	import { createKioskFaceApi } from '../data/kiosk-face.api';
	import type { KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
	import {
		faceOutcomeMessage,
		type FaceCheckFlow,
		type FaceCheckOutcome
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
	/** "Staff carry on" on the result screen; focus returns here when the PIN is cancelled. */
	let continueButton = $state<HTMLElement | null>(null);
	let sessionBusy = false;
	const busyReport = createBusyReport((busy) => onbusychange?.(busy));
	const faceApi = createKioskFaceApi();

	const pinFlow = untrack(
		() =>
			new FaceCheckPinFlow({
				mode: () => mode,
				cancelCheck: (reason) => void faceApi.cancel(reason),
				onfinish: (outcome) => onfinish(outcome),
				oncancel: () => oncancel(),
				onpinchange: reportBusy
			})
	);

	const session = untrack(
		() =>
			new FaceCheckSession({
				flow,
				citizenId,
				api: faceApi,
				openCamera: () => openFaceCamera(video!, cameraLabel),
				onfinish: (outcome) => pinFlow.finished(outcome),
				onbusychange: (busy) => {
					sessionBusy = busy;
					reportBusy();
				}
			})
	);
	pinFlow.attach(session);

	const pinOpen = $derived(pinFlow.pinOpen);
	const cameraShown = $derived(
		!pinOpen &&
			(session.phase === 'starting' ||
				session.phase === 'positioning' ||
				session.phase === 'verifying')
	);
	const finished = $derived(
		session.phase === 'done' && mode === 'on' && session.outcome !== null && !pinFlow.handedOn
	);
	const notMatched = $derived(
		finished && session.outcome !== null && session.outcome.kind !== 'match'
			? session.outcome
			: null
	);
	const notMatchedMessage = $derived(notMatched ? faceOutcomeMessage(notMatched) : null);
	/**
	 * Read out by the always-mounted live line below. The result boxes appear with their text already
	 * in them, which screen readers may skip, and the live region must not cover the PIN keys.
	 */
	const resultAnnouncement = $derived.by(() => {
		if (pinOpen || !finished) return '';
		if (session.outcome?.kind === 'match') return 'ยืนยันตัวตนเรียบร้อย';
		return notMatchedMessage ? `${notMatchedMessage.title} ${notMatchedMessage.detail}` : '';
	});
	// Check-in reads the chip photo during the check, so the card must stay in until it says so.
	const cardNoticeShown = $derived(flow === 'check_in' && session.phase !== 'done');

	/** The page's idle timeout pauses while the camera runs and while staff are on the PIN. */
	function reportBusy(): void {
		busyReport.update(sessionBusy || pinFlow.pinOpen);
	}

	async function handlePinCancel(): Promise<void> {
		const focus = pinFlow.pinCancelled();
		if (!focus) return;
		await tick();
		(focus === 'continue' ? continueButton : skipButton)?.focus();
	}

	/**
	 * The scanner client says when the card comes out. Only matters while staff are on the PIN from
	 * the camera: the session ends as `card_removed` if the chip photo was still needed.
	 */
	function listenForCardRemoval(): () => void {
		const handleCardRemoved = () => {
			if (flow === 'check_in' && pinFlow.pinFrom === 'camera') void session.cardRemoved();
		};
		window.addEventListener('kiosk:smart-card-removed', handleCardRemoved);
		return () => window.removeEventListener('kiosk:smart-card-removed', handleCardRemoved);
	}

	onMount(() => () => {
		pinFlow.destroy();
		session.destroy();
		// Unmounted mid-check or with the PIN panel open: never leave the page's idle timeout paused.
		busyReport.release();
	});
</script>

<section
	class="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8 kiosk-compact:mt-2 kiosk-compact:p-3"
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
		onskip={() => pinFlow.skip()}
	/>

	{#if pinOpen}
		<KioskStaffPinEntry
			{headingTag}
			verify={verifyStaffPin}
			onverified={() => pinFlow.pinVerified()}
			oncancel={() => void handlePinCancel()}
		/>
	{:else if finished && session.outcome?.kind === 'match'}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-950"
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
					onclick={() => pinFlow.openFromResult()}
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

	<p class="sr-only" aria-live="polite" data-testid="kiosk-face-announcement">
		{resultAnnouncement}
	</p>
</section>
