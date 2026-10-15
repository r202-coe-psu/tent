<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { KioskBannerAttract, type KioskBannerSlide } from '$lib/features/kiosk';
	import { PREVIEW_FRAMES, fitScale, type PreviewFrame } from './kiosk-banner-preview-frame';

	/**
	 * 「ตัวอย่างบน kiosk」: plays `slides` with the real kiosk overlay inside a simulated 1024×600 or
	 * 1080×1920 screen, scaled to fit (FR-KBN-29). A tap on the overlay replays it.
	 */
	let {
		open = $bindable(false),
		slides,
		emptyMessage = 'ไม่มีแบนเนอร์ที่แสดงอยู่ในขณะนี้'
	}: {
		open?: boolean;
		slides: KioskBannerSlide[];
		emptyMessage?: string;
	} = $props();

	let frame = $state.raw<PreviewFrame>(PREVIEW_FRAMES[0]);
	let spaceWidth = $state(0);
	let windowHeight = $state(0);
	let replay = $state(0);

	// Leave room for the dialog header and the frame toggle.
	const space = $derived({ width: spaceWidth, height: Math.max(windowHeight - 220, 0) });
	const scale = $derived(fitScale(frame, space));
</script>

<svelte:window bind:innerHeight={windowHeight} />

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[95dvh] gap-3 overflow-y-auto rounded-2xl sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title class="text-xl font-bold text-slate-900">ตัวอย่างบน kiosk</Dialog.Title>
			<Dialog.Description class="text-sm text-slate-500">
				จำลองหน้าจอตู้ kiosk ขณะไม่มีผู้ใช้งาน แตะที่ภาพเพื่อเล่นซ้ำ
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex gap-2" role="group" aria-label="ขนาดหน้าจอ kiosk">
			{#each PREVIEW_FRAMES as option (option.id)}
				<Button
					type="button"
					size="sm"
					variant={frame.id === option.id ? 'default' : 'outline'}
					aria-pressed={frame.id === option.id}
					class="min-h-11"
					onclick={() => (frame = option)}
				>
					{option.label}
				</Button>
			{/each}
		</div>

		<div bind:clientWidth={spaceWidth} class="flex min-h-40 justify-center">
			{#if slides.length === 0}
				<p class="self-center py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
			{:else if spaceWidth > 0}
				<!-- The transform makes this box the containing block of the overlay's `fixed` layout. -->
				<div
					data-testid="kiosk-preview-viewport"
					class="relative overflow-hidden rounded-lg border border-slate-300 bg-slate-950"
					style:width="{frame.width * scale}px"
					style:height="{frame.height * scale}px"
				>
					<div
						data-testid="kiosk-preview-frame"
						class="absolute top-0 left-0 origin-top-left overflow-hidden"
						style:width="{frame.width}px"
						style:height="{frame.height}px"
						style:transform="scale({scale})"
						style:--testing-banner-height="0px"
					>
						{#key `${frame.id}:${replay}`}
							<KioskBannerAttract mode="preview" banners={slides} onDismiss={() => replay++} />
						{/key}
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
