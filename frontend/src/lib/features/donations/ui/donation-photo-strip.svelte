<script lang="ts">
	import Images from '@lucide/svelte/icons/images';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { imageRepository } from '$lib/features/images';
	import DonationPhotoTile from './donation-photo-tile.svelte';
	import { revokeObjectUrlOnRemove } from './revoke-object-url';

	let {
		photoIds = [],
		shelterCode
	}: {
		/** `donation.photos` — `image:{ulid}` in the booking's shelter DB (CR-175 donor photos). */
		photoIds?: readonly string[];
		shelterCode: string;
	} = $props();

	let open = $state(false);
	let selected = $state<{ id: string; thumbUrl: string } | null>(null);

	// Read only when staff open a photo; the thumb stands in while it loads.
	const full = $derived(
		open && selected
			? imageRepository(shelterCode)
					.getFullImageUrl(selected.id)
					.catch(() => null)
			: Promise.resolve(null)
	);

	function openPhoto(id: string, thumbUrl: string) {
		selected = { id, thumbUrl };
		open = true;
	}
</script>

<!-- FR-13: a booking without photos shows nothing here. -->
{#if photoIds.length > 0}
	<section
		class="space-y-3"
		aria-labelledby="donation-photos-title"
		data-testid="donation-photo-strip"
	>
		<h3
			id="donation-photos-title"
			class="flex items-center gap-2 text-lg font-bold text-slate-900 sm:text-xl"
		>
			<Images class="size-6 text-slate-400" aria-hidden="true" />
			รูปจากผู้บริจาค
			<span class="text-base font-normal text-slate-600 tabular-nums">{photoIds.length} รูป</span>
		</h3>
		<ul class="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
			{#each photoIds as photoId, i (photoId)}
				<li>
					<DonationPhotoTile {photoId} {shelterCode} index={i + 1} onOpen={openPhoto} />
				</li>
			{/each}
		</ul>
	</section>

	<Dialog.Root bind:open>
		<Dialog.Content
			class="max-h-[90dvh] w-[min(100vw-2rem,48rem)] overflow-hidden border-slate-200/80 bg-white p-3 sm:max-w-3xl"
		>
			<Dialog.Header class="sr-only">
				<Dialog.Title>รูปจากผู้บริจาค</Dialog.Title>
				<Dialog.Description>รูปของบริจาคขนาดเต็ม</Dialog.Description>
			</Dialog.Header>
			<div class="flex min-h-48 items-center justify-center rounded-xl bg-slate-50">
				{#await full}
					{#if selected}
						<img
							src={selected.thumbUrl}
							alt="รูปของบริจาค"
							class="max-h-[min(80dvh,48rem)] w-full rounded-lg object-contain"
						/>
					{/if}
				{:then url}
					{#if url}
						<img
							src={url}
							alt="รูปของบริจาค"
							class="max-h-[min(80dvh,48rem)] w-full rounded-lg object-contain"
							data-testid="donation-photo-full"
							{@attach revokeObjectUrlOnRemove(url)}
						/>
					{:else if selected}
						<img
							src={selected.thumbUrl}
							alt="รูปของบริจาค"
							class="max-h-[min(80dvh,48rem)] w-full rounded-lg object-contain"
						/>
					{/if}
				{/await}
			</div>
		</Dialog.Content>
	</Dialog.Root>
{/if}
