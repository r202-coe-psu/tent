<script lang="ts">
	import ImageOff from '@lucide/svelte/icons/image-off';
	import { imageRepository } from '$lib/features/images';
	import { revokeObjectUrlOnRemove } from './revoke-object-url';

	let {
		photoId,
		shelterCode,
		index,
		onOpen
	}: {
		photoId: string;
		shelterCode: string;
		/** 1-based, for the button's accessible name. */
		index: number;
		onOpen: (photoId: string, thumbUrl: string) => void;
	} = $props();

	// FR-13b: a photo that cannot be read is a gap in the strip, never an error.
	const thumb = $derived(
		imageRepository(shelterCode)
			.getThumbnailUrl(photoId)
			.catch(() => null)
	);
</script>

{#await thumb}
	<div
		class="aspect-square size-full animate-pulse rounded-xl border border-slate-200/80 bg-slate-100"
		role="status"
	>
		<span class="sr-only">กำลังโหลดรูปที่ {index}</span>
	</div>
{:then url}
	{#if url}
		<button
			type="button"
			onclick={() => onOpen(photoId, url)}
			class="block aspect-square size-full cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 bg-slate-50 p-0 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
			data-testid="donation-photo-thumb"
		>
			<img src={url} alt="" class="size-full object-cover" {@attach revokeObjectUrlOnRemove(url)} />
			<span class="sr-only">ดูรูปที่ {index} ขนาดเต็ม</span>
		</button>
	{:else}
		<div
			class="flex aspect-square size-full flex-col items-center justify-center gap-1 rounded-xl border border-slate-200/80 bg-slate-50 p-2 text-center text-sm font-semibold text-slate-500"
			data-testid="donation-photo-missing"
		>
			<ImageOff class="size-5 text-slate-400" aria-hidden="true" />
			รูปไม่พร้อมใช้
		</div>
	{/if}
{/await}
