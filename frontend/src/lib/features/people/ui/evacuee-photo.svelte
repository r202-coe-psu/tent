<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { imageRepository } from '$lib/features/images';

	let {
		photoId = null,
		alt = 'รูปผู้พักพิง',
		size = 'md',
		class: className = ''
	}: {
		photoId?: string | null;
		alt?: string;
		/** Thumbnail display size */
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	} = $props();

	let thumbUrl = $state<string | null>(null);
	let fullUrl = $state<string | null>(null);
	let lightboxOpen = $state(false);
	let loadingFull = $state(false);

	const sizeClass = $derived(
		size === 'sm' ? 'size-12' : size === 'lg' ? 'size-24' : 'size-16'
	);

	$effect(() => {
		const id = photoId;
		let cancelled = false;
		let objectUrl: string | null = null;

		if (id) {
			imageRepository()
				.getThumbnailUrl(id)
				.then((url) => {
					if (cancelled) {
						if (url) URL.revokeObjectURL(url);
						return;
					}
					objectUrl = url;
					thumbUrl = url;
				});
		} else {
			thumbUrl = null;
		}

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	$effect(() => {
		if (!lightboxOpen) {
			return;
		}

		const id = photoId;
		if (!id) return;

		let cancelled = false;
		let objectUrl: string | null = null;
		loadingFull = true;

		imageRepository()
			.getFullImageUrl(id)
			.then((url) => {
				if (cancelled) {
					if (url) URL.revokeObjectURL(url);
					return;
				}
				objectUrl = url;
				fullUrl = url;
				loadingFull = false;
			})
			.catch(() => {
				if (!cancelled) loadingFull = false;
			});

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
			fullUrl = null;
			loadingFull = false;
		};
	});

	function openLightbox() {
		if (!photoId) return;
		lightboxOpen = true;
	}
</script>

{#if thumbUrl}
	<button
		type="button"
		onclick={openLightbox}
		aria-label="ดูรูปขนาดใหญ่"
		title="คลิกเพื่อดูรูปขนาดใหญ่"
		class="shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 p-0 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 {sizeClass} {className}"
	>
		<img src={thumbUrl} {alt} class="size-full object-cover" />
	</button>
{:else}
	<div
		class="flex shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-400 select-none {sizeClass} {className}"
		aria-hidden="true"
	>
		ไม่มีรูป
	</div>
{/if}

<Dialog.Root bind:open={lightboxOpen}>
	<Dialog.Content
		class="max-h-[90dvh] w-[min(100vw-2rem,36rem)] overflow-hidden border-slate-200/80 bg-white p-3 sm:max-w-xl"
	>
		<Dialog.Header class="sr-only">
			<Dialog.Title>รูปผู้พักพิง</Dialog.Title>
			<Dialog.Description>{alt}</Dialog.Description>
		</Dialog.Header>
		<div class="flex min-h-48 items-center justify-center rounded-xl bg-slate-50">
			{#if loadingFull && !fullUrl}
				<p class="text-sm font-medium text-slate-500">กำลังโหลดรูป…</p>
			{:else if fullUrl}
				<img
					src={fullUrl}
					{alt}
					class="max-h-[min(80dvh,40rem)] w-full rounded-lg object-contain"
				/>
			{:else if thumbUrl}
				<img
					src={thumbUrl}
					{alt}
					class="max-h-[min(80dvh,40rem)] w-full rounded-lg object-contain"
				/>
			{:else}
				<p class="text-sm font-medium text-slate-500">ไม่พบรูป</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
