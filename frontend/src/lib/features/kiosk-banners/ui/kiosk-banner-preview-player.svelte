<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { KioskBannerAttract, type KioskBannerSlide } from '$lib/features/kiosk';
	import {
		KIOSK_SCREENS,
		KIOSK_SCREEN_TYPES,
		type KioskScreenType
	} from '$lib/features/shared/domain/kiosk-screen';
	import { PREVIEW_FRAMES, fitScale } from './kiosk-banner-preview-frame';

	/**
	 * The body of the preview dialog: screen toggle + simulated kiosk screen. It is mounted with the
	 * dialog content, so the chosen screen starts afresh every time the dialog opens.
	 */
	let {
		slides,
		screens = KIOSK_SCREEN_TYPES,
		initialScreen,
		emptyMessage,
		windowHeight
	}: {
		slides: Record<KioskScreenType, KioskBannerSlide[]>;
		screens?: readonly KioskScreenType[];
		initialScreen?: KioskScreenType;
		emptyMessage?: string;
		windowHeight: number;
	} = $props();

	const screenLabel = (type: KioskScreenType) =>
		`${KIOSK_SCREENS[type].label} ${KIOSK_SCREENS[type].size}`;

	let chosen = $state<KioskScreenType | null>(null);
	let spaceWidth = $state(0);
	let replay = $state(0);

	const startScreen = $derived(
		initialScreen && screens.includes(initialScreen)
			? initialScreen
			: (screens.find((type) => slides[type].length > 0) ?? screens[0])
	);
	const screen = $derived(chosen && screens.includes(chosen) ? chosen : startScreen);
	const frame = $derived(PREVIEW_FRAMES.find((f) => f.id === screen) ?? PREVIEW_FRAMES[0]);
	const playing = $derived(slides[screen]);
	const message = $derived(
		emptyMessage ?? `ไม่มีแบนเนอร์${KIOSK_SCREENS[screen].label}ที่แสดงอยู่ในขณะนี้`
	);

	// Leave room for the dialog header and the screen toggle.
	const space = $derived({ width: spaceWidth, height: Math.max(windowHeight - 220, 0) });
	const scale = $derived(fitScale(frame, space));
</script>

{#if screens.length > 1}
	<div class="flex flex-wrap gap-2" role="group" aria-label="ขนาดหน้าจอ kiosk">
		{#each screens as type (type)}
			<Button
				type="button"
				size="sm"
				variant={screen === type ? 'default' : 'outline'}
				aria-pressed={screen === type}
				class="min-h-11"
				onclick={() => (chosen = type)}
			>
				{screenLabel(type)} ({slides[type].length})
			</Button>
		{/each}
	</div>
{:else}
	<p class="text-sm font-medium text-slate-700">
		{screenLabel(screen)}
	</p>
{/if}

<div bind:clientWidth={spaceWidth} class="flex min-h-40 justify-center">
	{#if playing.length === 0}
		<p class="self-center py-10 text-center text-sm text-muted-foreground">{message}</p>
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
					<KioskBannerAttract mode="preview" banners={playing} onDismiss={() => replay++} />
				{/key}
			</div>
		</div>
	{/if}
</div>
