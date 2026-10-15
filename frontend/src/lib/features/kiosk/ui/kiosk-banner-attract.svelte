<script lang="ts">
	import { fade } from 'svelte/transition';
	import { fetchKioskBanners } from '../data/kiosk-banners.api';
	import type { KioskBannerSlide } from '../domain/kiosk-banner-feed';
	import { KioskBannerAttractController } from './kiosk-banner-attract.svelte.js';
	import { swallowNextClick } from './kiosk-swallow-click';

	// Flat on purpose: Svelte wraps `$props()` in `Omit<Props, ...>`, which collapses a union to its
	// shared keys and would hide `banners` / `onDismiss` from `mode="preview"` callers.
	type Props = {
		mode: 'live' | 'preview';
		/** `preview` only: the slides to play, in order. */
		banners?: KioskBannerSlide[];
		/** `preview` only: called when the overlay is tapped away. */
		onDismiss?: () => void;
	};

	/**
	 * Attract overlay for `/kiosk` (CR-162 FR-KBN-42..47). `live` owns the idle/refresh state
	 * machine; `preview` (back-office) shows the given slides at once, with no idle or refresh timer.
	 */
	let { mode, banners = [], onDismiss }: Props = $props();

	// `mode` never changes for a mounted instance.
	// svelte-ignore state_referenced_locally
	const controller =
		mode === 'live' ? new KioskBannerAttractController({ fetch: fetchKioskBanners }) : null;

	let previewIndex = $state(0);
	let previewDismissed = $state(false);
	let previewBroken = $state.raw<string[]>([]);
	let cancelSwallow: (() => void) | null = null;

	const previewSlides = $derived(
		mode === 'preview' ? banners.filter((s) => !previewBroken.includes(s.id)) : []
	);
	const slides = $derived(controller ? controller.slides : previewSlides);
	const index = $derived(
		controller ? controller.index : previewIndex % Math.max(previewSlides.length, 1)
	);
	const current = $derived(slides[index] ?? null);
	const showing = $derived(
		controller ? controller.phase === 'showing' : !previewDismissed && previewSlides.length > 0
	);

	// Lifecycle only: start/stop the live controller, drop a pending click guard, rotate the preview.
	$effect(() => {
		controller?.start();
		return () => {
			controller?.destroy();
			cancelSwallow?.();
		};
	});

	$effect(() => {
		if (controller || previewDismissed || previewSlides.length <= 1 || !current) return;
		const timer = setTimeout(
			() => (previewIndex = (index + 1) % previewSlides.length),
			current.duration_sec * 1000
		);
		return () => clearTimeout(timer);
	});

	function dismiss(swallowClick: boolean) {
		cancelSwallow?.();
		cancelSwallow = swallowClick ? swallowNextClick() : null;
		if (controller) {
			controller.dismiss();
		} else if (!previewDismissed) {
			previewDismissed = true;
			onDismiss?.();
		}
	}

	function onOverlayPointerdown(event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		dismiss(true);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (!controller) return;
		if (controller.phase === 'showing') {
			event.preventDefault();
			event.stopPropagation();
			dismiss(false);
		} else {
			controller.recordActivity();
		}
	}

	function markBroken(id: string) {
		if (controller) controller.markBroken(id);
		else previewBroken = [...previewBroken, id];
	}
</script>

<svelte:window
	onkeydowncapture={onWindowKeydown}
	onpointerdowncapture={() => controller?.recordActivity()}
/>

{#if showing && current}
	<!-- Sits below the fixed system banner (z-50) and leaves its height free (FR-KBN-46). -->
	<div
		role="presentation"
		data-testid="kiosk-banner-attract"
		class="fixed inset-x-0 top-0 bottom-[var(--testing-banner-height)] z-40 flex touch-none flex-col items-center overflow-hidden bg-slate-950 text-white select-none"
		onpointerdown={onOverlayPointerdown}
		transition:fade={{ duration: 300 }}
	>
		<div class="relative min-h-0 w-full flex-1 p-4 kiosk-compact:p-2">
			{#key current.id}
				<img
					src={current.image_url}
					alt={current.title}
					class="absolute inset-0 h-full w-full object-contain"
					draggable="false"
					onerror={() => markBroken(current.id)}
					in:fade={{ duration: 300 }}
				/>
			{/key}
		</div>
		<div
			class="flex shrink-0 flex-col items-center gap-3 px-6 pt-2 pb-6 text-center kiosk-compact:gap-1 kiosk-compact:pb-2"
		>
			{#if current.caption}
				<p class="max-w-4xl text-2xl font-semibold kiosk-compact:text-lg">{current.caption}</p>
			{/if}
			{#if slides.length > 1}
				<div class="flex items-center gap-2" aria-hidden="true">
					{#each slides as slide (slide.id)}
						<span
							data-testid="kiosk-banner-dot"
							data-current={slide.id === current.id}
							class="size-3 rounded-full kiosk-compact:size-2 {slide.id === current.id
								? 'bg-white'
								: 'bg-white/30'}"
						></span>
					{/each}
				</div>
			{/if}
			<p class="text-xl font-semibold text-sky-200 kiosk-compact:text-base">
				แตะหน้าจอเพื่อเริ่มใช้งาน
			</p>
		</div>
	</div>
{/if}
