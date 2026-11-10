<script lang="ts">
	import { fetchInternalBanners } from '../data/internal-banners.api';
	import { InternalBannerDisplayController } from './internal-banner-display.svelte.js';

	interface Props {
		shelter: string;
		code: string;
		/** Called when the feed says the code is wrong or was re-issued. */
		oninvalid: () => void;
	}

	let { shelter, code, oninvalid }: Props = $props();

	// The route keys this component on `shelter` + `code`, so they never change for an instance.
	const controller = new InternalBannerDisplayController({
		fetch: async () => {
			const result = await fetchInternalBanners(shelter, code);
			if (result.kind === 'not_found') oninvalid();
			return result;
		}
	});

	// Lifecycle only: start the fetch/rotation timers on mount, stop them on unmount.
	$effect(() => {
		controller.start();
		return () => controller.destroy();
	});
</script>

<main class="fixed inset-0 cursor-none overflow-hidden bg-black select-none">
	{#if controller.status === 'playing' && controller.current}
		{#key controller.current.id}
			<img
				src={controller.current.image_url}
				alt={controller.current.title}
				class="h-full w-full object-contain"
				draggable="false"
			/>
		{/key}
	{:else if controller.status === 'empty'}
		<p class="flex h-full items-center justify-center text-4xl font-medium text-slate-300">
			ยังไม่มีสื่อให้แสดง
		</p>
	{/if}
</main>
