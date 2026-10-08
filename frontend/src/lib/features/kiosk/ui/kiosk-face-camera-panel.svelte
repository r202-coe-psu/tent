<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		/** The camera element: bound by the page so the camera can open into it. */
		video?: HTMLVideoElement;
		headingTag?: 'h1' | 'h2';
		/** Panel on screen. It stays mounted when hidden: the camera opens into <video> before a re-render. */
		shown: boolean;
		starting: boolean;
		verifying: boolean;
		message: string;
		/** Attempts already used (0 on the first). */
		attempt: number;
		maxAttempts: number;
		/** Positioning has taken long: say staff will help if it does not work out. */
		slow: boolean;
		/** Face framed well enough to take the photo / a problem to fix (never colour alone). */
		frameReady: boolean;
		framingProblem: boolean;
		/** "Staff skip this step" is offered while the camera step runs. */
		showSkip: boolean;
		onskip: () => void;
		/** The skip button, so focus can come back to it when the staff PIN panel closes. */
		skipButton?: HTMLElement | null;
	}

	let {
		video = $bindable(),
		headingTag = 'h1',
		shown,
		starting,
		verifying,
		message,
		attempt,
		maxAttempts,
		slow,
		frameReady,
		framingProblem,
		showSkip,
		onskip,
		skipButton = $bindable(null)
	}: Props = $props();

	const tone = $derived(frameReady ? 'ready' : framingProblem ? 'problem' : 'idle');
</script>

<div
	class={['space-y-4 text-center kiosk-compact:space-y-2', shown ? 'block' : 'hidden']}
	data-testid="kiosk-face-camera"
>
	<svelte:element
		this={headingTag}
		class="text-2xl font-bold text-[#0A2647] kiosk-portrait:text-4xl kiosk-compact:text-xl"
		>ตรวจสอบใบหน้า</svelte:element
	>
	<!-- Short screens: the picture on the left, the words and buttons on the right. -->
	<div
		class="space-y-4 kiosk-compact:flex kiosk-compact:items-center kiosk-compact:gap-6 kiosk-compact:space-y-0"
	>
		<div
			class="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 kiosk-portrait:max-w-3xl kiosk-compact:w-[15rem] kiosk-compact:max-w-[15rem] kiosk-compact:shrink-0"
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
					class={[
						'aspect-[3/4] h-[84%] rounded-[50%] border-4 transition-colors motion-reduce:transition-none',
						tone === 'ready' && 'border-emerald-500',
						tone === 'problem' && 'border-amber-400',
						tone === 'idle' && 'border-white/90'
					]}
					data-testid="kiosk-face-guide"
					data-face-guide={tone}
					aria-hidden="true"
				></div>
			</div>
			{#if tone !== 'idle'}
				<span
					class={[
						'pointer-events-none absolute top-2 right-2 flex size-8 items-center justify-center rounded-full border bg-white kiosk-portrait:size-14',
						tone === 'ready'
							? 'border-emerald-300 text-emerald-700'
							: 'border-amber-300 text-amber-700'
					]}
					data-testid="kiosk-face-guide-icon"
					aria-hidden="true"
				>
					{#if tone === 'ready'}
						<Check class="size-5 kiosk-portrait:size-9" strokeWidth={3} />
					{:else}
						<CircleAlert class="size-5 kiosk-portrait:size-9" />
					{/if}
				</span>
			{/if}
		</div>
		<div class="space-y-4 kiosk-compact:min-w-0 kiosk-compact:flex-1 kiosk-compact:space-y-2">
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
				{:else if starting}
					กำลังเปิดกล้อง…
				{:else}
					{message}
				{/if}
			</p>
			{#if attempt > 0}
				<p class="text-sm font-semibold text-slate-600 tabular-nums kiosk-portrait:text-xl">
					ครั้งที่ {attempt + 1} จาก {maxAttempts}
				</p>
			{/if}
			{#if slow}
				<p class="text-sm text-slate-600 kiosk-portrait:text-xl" data-testid="kiosk-face-slow">
					หากยังไม่สำเร็จ ระบบจะให้เจ้าหน้าที่ช่วยตรวจ
				</p>
			{/if}
			{#if showSkip}
				<div class="flex justify-center">
					<Button
						bind:ref={skipButton}
						type="button"
						variant="outline"
						onclick={onskip}
						class="min-h-12 px-6 text-base focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
						>เจ้าหน้าที่ข้ามขั้นตอนนี้</Button
					>
				</div>
			{/if}
		</div>
	</div>
</div>
