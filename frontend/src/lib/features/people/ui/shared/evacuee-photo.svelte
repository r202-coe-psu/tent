<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { imageRepository } from '$lib/features/images';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { EVACUEE_PHOTO_I18N } from '../_constants/evacuee-photo.i18n';

	let {
		photoId = null,
		alt,
		size = 'md',
		class: className = ''
	}: {
		photoId?: string | null;
		alt?: string;
		/** Thumbnail display size */
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_PHOTO_I18N, langState.current));
	const altText = $derived(alt ?? t.defaultAlt);

	let thumbUrl = $state<string | null>(null);
	let fullUrl = $state<string | null>(null);
	let lightboxOpen = $state(false);
	let loadingFull = $state(false);

	const sizeClass = $derived(size === 'sm' ? 'size-12' : size === 'lg' ? 'size-24' : 'size-16');

	$effect(() => {
		const id = photoId;
		let cancelled = false;
		let objectUrl: string | null = null;

		if (id) {
			imageRepository()
				.getThumbnailUrl(id)
				.then((url) => {
					if (cancelled) {
						if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
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
			if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
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
					if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
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
			if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
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
		aria-label={t.viewLarge}
		title={t.clickToViewLarge}
		class="shrink-0 cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 p-0 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {sizeClass} {className}"
	>
		<img src={thumbUrl} alt={altText} class="size-full object-cover" />
	</button>
{:else}
	<div
		class="flex shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-400 select-none {sizeClass} {className}"
		aria-hidden="true"
	>
		{t.noPhoto}
	</div>
{/if}

<Dialog.Root bind:open={lightboxOpen}>
	<Dialog.Content
		class="max-h-[90dvh] w-[min(100vw-2rem,36rem)] overflow-hidden border-slate-200/80 bg-white p-3 sm:max-w-xl"
	>
		<Dialog.Header class="sr-only">
			<Dialog.Title>{t.defaultAlt}</Dialog.Title>
			<Dialog.Description>{altText}</Dialog.Description>
		</Dialog.Header>
		<div class="flex min-h-48 items-center justify-center rounded-xl bg-slate-50">
			{#if loadingFull && !fullUrl}
				<p class="text-sm font-medium text-slate-500">{t.loadingPhoto}</p>
			{:else if fullUrl}
				<img
					src={fullUrl}
					alt={altText}
					class="max-h-[min(80dvh,40rem)] w-full rounded-lg object-contain"
				/>
			{:else if thumbUrl}
				<img
					src={thumbUrl}
					alt={altText}
					class="max-h-[min(80dvh,40rem)] w-full rounded-lg object-contain"
				/>
			{:else}
				<p class="text-sm font-medium text-slate-500">{t.photoNotFound}</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
