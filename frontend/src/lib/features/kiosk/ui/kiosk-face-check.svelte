<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import UserRoundSearch from '@lucide/svelte/icons/user-round-search';
	import { Button } from '$lib/components/ui/button/index.js';
	import { openFaceCamera } from '../application/face-camera';
	import { FaceCheckSession } from '../application/face-check-session.svelte';
	import { createKioskFaceApi } from '../data/kiosk-face.api';
	import {
		FACE_MATCH_SHOWN_MS,
		faceOutcomeIsPersonalChoice,
		type FaceCheckFlow,
		type FaceCheckOutcome
	} from '../domain/face-check';
	import KioskBiometricConsent from './kiosk-biometric-consent.svelte';
	import KioskFaceCameraPanel from './kiosk-face-camera-panel.svelte';
	import KioskFaceCardNotice from './kiosk-face-card-notice.svelte';

	interface Props {
		flow: FaceCheckFlow;
		citizenId: string;
		/** shadow: runs the check but never shows the person a result. on: shows it. */
		mode: 'shadow' | 'on';
		/** Which of the kiosk's cameras to use (same label as the QR camera); null = front camera. */
		cameraLabel: string | null;
		/** The person should move on: ended in any way, and (for a result screen) pressed continue. */
		onfinish: (outcome: FaceCheckOutcome) => void;
		/** True while the camera is running, so the page can pause its idle timeout. */
		onbusychange?: (busy: boolean) => void;
		/** The page already has an h1 (the check-in header): headings here become h2. */
		embedded?: boolean;
	}

	let {
		flow,
		citizenId,
		mode,
		cameraLabel,
		onfinish,
		onbusychange,
		embedded = false
	}: Props = $props();
	const headingTag = $derived(embedded ? 'h2' : 'h1');

	let video = $state<HTMLVideoElement>();
	let matchTimer: ReturnType<typeof setTimeout> | null = null;

	const session = untrack(
		() =>
			new FaceCheckSession({
				flow,
				citizenId,
				api: createKioskFaceApi(),
				openCamera: () => openFaceCamera(video!, cameraLabel),
				onfinish: handleFinished,
				onbusychange: (busy) => onbusychange?.(busy)
			})
	);

	const cameraShown = $derived(session.phase === 'starting' || session.phase === 'positioning');
	const verifying = $derived(session.phase === 'verifying');
	const resultShown = $derived(
		session.phase === 'done' &&
			mode === 'on' &&
			session.outcome !== null &&
			!faceOutcomeIsPersonalChoice(session.outcome)
	);
	// Check-in reads the chip photo during the check, so the card must stay in until it says so.
	const cardNoticeShown = $derived(flow === 'check_in' && session.phase !== 'done');

	function handleFinished(outcome: FaceCheckOutcome): void {
		// Declining or skipping is the person's own choice: carry on, no result screen.
		if (mode === 'shadow' || faceOutcomeIsPersonalChoice(outcome)) {
			onfinish(outcome);
		} else if (outcome.kind === 'match') {
			matchTimer = setTimeout(() => onfinish(outcome), FACE_MATCH_SHOWN_MS);
		}
		// Anything else waits for the person to press "continue".
	}

	function continueWithStaff(): void {
		if (session.outcome) onfinish(session.outcome);
	}

	onMount(() => () => {
		if (matchTimer) clearTimeout(matchTimer);
		session.destroy();
	});
</script>

<section
	class="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8 kiosk-compact:mt-2 kiosk-compact:p-3"
	aria-live="polite"
	data-testid="kiosk-face-check"
	data-face-phase={session.phase}
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
		{headingTag}
		shown={cameraShown || verifying}
		starting={session.phase === 'starting'}
		{verifying}
		message={session.message}
		attempt={session.attempt}
		maxAttempts={session.maxAttempts}
		slow={session.slow}
		frameReady={session.frameReady}
		framingProblem={session.framingProblem}
		showSkip={session.busy}
		onskip={() => session.skip()}
	/>

	{#if resultShown && session.outcome}
		{#if session.outcome.kind === 'match'}
			<div
				class="flex flex-col items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-emerald-950"
				role="status"
				data-testid="kiosk-face-result"
			>
				<CheckCircle2 class="size-12 kiosk-portrait:size-20" aria-hidden="true" />
				<svelte:element this={headingTag} class="text-2xl font-bold kiosk-portrait:text-4xl"
					>ยืนยันตัวตนเรียบร้อย</svelte:element
				>
			</div>
		{:else}
			<div
				class="flex flex-col items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-6 text-center text-sky-950"
				role="status"
				data-testid="kiosk-face-result"
			>
				<UserRoundSearch class="size-12 kiosk-portrait:size-20" aria-hidden="true" />
				<svelte:element this={headingTag} class="text-2xl font-bold kiosk-portrait:text-4xl"
					>ระบบยืนยันไม่ได้ในขณะนี้</svelte:element
				>
				<p class="text-base kiosk-portrait:text-2xl">
					เจ้าหน้าที่จะช่วยตรวจสอบตัวตนให้ท่าน ท่านดำเนินการต่อได้เลย
				</p>
				<Button
					type="button"
					onclick={continueWithStaff}
					class="mt-2 min-h-12 bg-[#0A2647] px-8 text-base font-bold text-white hover:bg-[#051930] kiosk-portrait:min-h-16 kiosk-portrait:text-2xl"
					>ดำเนินการต่อ</Button
				>
			</div>
		{/if}
	{/if}
</section>
