<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { KioskBannerSlide } from '$lib/features/kiosk';
	import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import KioskBannerPreviewPlayer from './kiosk-banner-preview-player.svelte';

	/**
	 * 「ตัวอย่างบน kiosk」: plays the slides of one screen type with the real kiosk overlay inside a
	 * simulated 1024×600 or 1080×1920 screen, scaled to fit (FR-KBN-29, FR-KBR-44). A tap on the
	 * overlay replays it.
	 */
	let {
		open = $bindable(false),
		slides,
		screens,
		initialScreen,
		emptyMessage
	}: {
		open?: boolean;
		slides: Record<KioskScreenType, KioskBannerSlide[]>;
		/** Screens offered (default both). A single one hides the toggle. */
		screens?: readonly KioskScreenType[];
		/** Screen shown first; default is the first screen that has slides. */
		initialScreen?: KioskScreenType;
		/** Overrides the per-screen「ไม่มีแบนเนอร์…」message. */
		emptyMessage?: string;
	} = $props();

	let windowHeight = $state(0);
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

		<KioskBannerPreviewPlayer {slides} {screens} {initialScreen} {emptyMessage} {windowHeight} />
	</Dialog.Content>
</Dialog.Root>
