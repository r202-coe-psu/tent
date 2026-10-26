<script lang="ts">
	import Camera from '@lucide/svelte/icons/camera';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { formatBytes } from '$lib/utils/image-compress';
	import { DONATION_PHOTOS_MAX_TOTAL_BYTES } from '../domain/donation-photos';
	import type { DonorPhotoRefusal, DonorPhotos } from '../application/donor-photos.svelte';

	let { photos, shelterCode }: { photos: DonorPhotos; shelterCode: string } = $props();

	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));
	const usedPercent = $derived(
		Math.min(100, Math.round((photos.budget.bytes / DONATION_PHOTOS_MAX_TOTAL_BYTES) * 100))
	);

	const pickerClass = `${buttonVariants({ variant: 'outline' })} min-h-11 w-full cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-slate-900 peer-focus-visible:ring-offset-2`;

	function refusalMessage(reason: DonorPhotoRefusal, name: string): string {
		const template = {
			original_too_large: t.photoRefusedTooLarge,
			no_room: t.photoRefusedNoRoom,
			unreadable: t.photoRefusedUnreadable,
			upload_failed: t.photoRefusedUpload
		}[reason];
		return template.replace('{name}', name);
	}

	async function onPick(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		// Cleared so picking the same file again still fires `change`.
		input.value = '';
		if (files.length === 0) return;
		await photos.add(files, shelterCode, (reason, file) =>
			toast.error(refusalMessage(reason, file.name))
		);
	}
</script>

<section
	class="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs"
	aria-labelledby="donor-photos-title"
	data-testid="donor-photo-picker"
>
	<div class="space-y-1">
		<h4 id="donor-photos-title" class="text-base font-semibold text-slate-800">
			{t.photoSectionTitle}
		</h4>
		<p class="text-sm text-slate-500">{t.photoSectionDesc}</p>
	</div>

	<p
		class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
	>
		<ShieldAlert class="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
		<span>{t.photoPrivacyWarning}</span>
	</p>

	{#if photos.items.length > 0}
		<ul class="grid grid-cols-3 gap-3 sm:grid-cols-5">
			{#each photos.items as photo (photo.key)}
				<li class="relative aspect-square overflow-hidden rounded-xl border border-slate-200">
					<img src={photo.previewUrl} alt="" class="size-full object-cover" />
					{#if photo.state === 'uploading'}
						<div
							class="absolute inset-0 flex items-center justify-center bg-white/70"
							role="status"
						>
							<LoaderCircle class="size-6 animate-spin text-slate-600" aria-hidden="true" />
							<span class="sr-only">{t.photoUploading}</span>
						</div>
					{/if}
					<button
						type="button"
						onclick={() => photos.remove(photo.key)}
						class="absolute top-0 right-0 inline-flex size-11 items-start justify-end rounded-xl p-1 text-white focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						<span
							class="inline-flex size-7 items-center justify-center rounded-full bg-slate-900/70"
						>
							<X class="size-4" aria-hidden="true" />
						</span>
						<span class="sr-only">{t.photoRemoveAria}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="space-y-1.5">
		<div
			class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-slate-600 tabular-nums"
		>
			<span>{t.photoUsage.replace('{used}', formatBytes(photos.budget.bytes))}</span>
			<span>{t.photoCount.replace('{count}', String(photos.budget.count))}</span>
		</div>
		<div
			class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={usedPercent}
			aria-label={t.photoUsage.replace('{used}', formatBytes(photos.budget.bytes))}
		>
			<div
				class="h-full rounded-full bg-domain-donation-strong transition-all duration-300"
				style="width: {usedPercent}%"
			></div>
		</div>
	</div>

	{#if photos.budget.full}
		<p class="text-sm font-semibold text-slate-600">{t.photoFull}</p>
	{:else}
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div>
				<input
					id="donor-photo-gallery"
					type="file"
					accept="image/*"
					multiple
					class="peer sr-only"
					data-testid="donor-photo-input"
					onchange={onPick}
				/>
				<label for="donor-photo-gallery" class={pickerClass}>
					<ImagePlus class="size-5" aria-hidden="true" />
					{t.photoAddBtn}
				</label>
			</div>
			<div>
				<input
					id="donor-photo-camera"
					type="file"
					accept="image/*"
					capture="environment"
					class="peer sr-only"
					onchange={onPick}
				/>
				<label for="donor-photo-camera" class={pickerClass}>
					<Camera class="size-5" aria-hidden="true" />
					{t.photoTakeBtn}
				</label>
			</div>
		</div>
	{/if}
</section>
