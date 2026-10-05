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
		type FaceCheckFlow,
		type FaceCheckOutcome
	} from '../domain/face-check';
	import KioskBiometricConsent from './kiosk-biometric-consent.svelte';

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
		session.phase === 'done' && mode === 'on' && session.outcome?.kind !== 'declined'
	);

	function handleFinished(outcome: FaceCheckOutcome): void {
		if (mode === 'shadow' || outcome.kind === 'declined') {
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
	class="mx-auto mt-4 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs sm:p-8 kiosk-compact:p-4"
	aria-live="polite"
	data-testid="kiosk-face-check"
	data-face-phase={session.phase}
>
	{#if session.phase === 'consent'}
		<KioskBiometricConsent
			{headingTag}
			onagree={() => void session.agree()}
			ondecline={() => session.decline()}
		/>
	{/if}

	<!-- Always mounted: the camera opens into it before the next render could mount it. -->
	<div class={['space-y-4 text-center', cameraShown || verifying ? 'block' : 'hidden']}>
		<svelte:element
			this={headingTag}
			class="text-2xl font-bold text-[#0A2647] kiosk-portrait:text-4xl"
			>ตรวจสอบใบหน้า</svelte:element
		>
		<div
			class="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 kiosk-portrait:max-w-3xl kiosk-compact:max-w-xs"
		>
			<video
				bind:this={video}
				class="size-full -scale-x-100 object-cover"
				autoplay
				playsinline
				muted
				aria-label="ภาพจากกล้อง"
			></video>
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
				<div
					class="aspect-[3/4] h-[84%] rounded-[50%] border-4 border-white/90"
					aria-hidden="true"
				></div>
			</div>
		</div>
		<p
			class="text-xl font-bold text-slate-900 kiosk-portrait:text-3xl kiosk-compact:text-lg"
			role="status"
			data-testid="kiosk-face-message"
		>
			{#if verifying}
				<span
					class="mr-2 inline-block size-5 animate-spin rounded-full border-2 border-slate-300 border-t-[#0A2647] align-middle motion-reduce:animate-none"
					aria-hidden="true"
				></span>กำลังตรวจสอบ…
			{:else if session.phase === 'starting'}
				กำลังเปิดกล้อง…
			{:else}
				{session.message}
			{/if}
		</p>
		{#if session.attempt > 0}
			<p class="text-sm font-semibold text-slate-600 tabular-nums kiosk-portrait:text-xl">
				ครั้งที่ {session.attempt + 1}
			</p>
		{/if}
	</div>

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
