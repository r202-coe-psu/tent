<script lang="ts">
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Camera from '@lucide/svelte/icons/camera';
	import X from '@lucide/svelte/icons/x';
	import { onDestroy, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useSaveImage } from '$lib/features/images';
	import {
		uploadShelterBookingPhoto,
		uploadUnassignedPhoto
	} from '$lib/features/public-register/data/public-register.api';
	import { compressImage } from '$lib/utils/image-compress';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import { isMeaningfulOtherPetNotes } from '../../domain/people';
	import type { UnifiedRegistrationChannel } from '../../domain/unified-registration';
	import {
		forgetPhotoPreview,
		rememberPhotoPreview,
		resolvePhotoPreviewUrl
	} from './registration-photo-preview';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';
	import { createPetCard, getPetTitle, type PetCardItem } from './unified-registration-pets';

	let {
		petItems = $bindable<PetCardItem[]>(),
		pending = false,
		showPetPhotoUpload = false,
		channel = 'onsite',
		enableUnassignedPhoto = false,
		shelterCode = '',
		onsync
	}: {
		petItems: PetCardItem[];
		pending?: boolean;
		showPetPhotoUpload?: boolean;
		channel?: UnifiedRegistrationChannel;
		enableUnassignedPhoto?: boolean;
		shelterCode?: string;
		onsync?: () => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));
	const totalPetCount = $derived(petItems.length);

	let nextPetId = untrack(() => Math.max(0, ...petItems.map((p) => p.id), 0) + 1);
	let uploadingPetId = $state<number | null>(null);

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const saveImage = safeQuery(() => useSaveImage(), {
		mutateAsync: async () => {
			throw new Error('image upload unavailable');
		}
	} as unknown as ReturnType<typeof useSaveImage>);

	function notifySync() {
		onsync?.();
	}

	function revokePetPreview(pet: PetCardItem) {
		if (pet.previewUrl?.startsWith('blob:') && pet.image_url) {
			// Session cache owns the blob for remount restore.
			pet.previewUrl = null;
			return;
		}
		if (pet.previewUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(pet.previewUrl);
		}
		pet.previewUrl = null;
	}

	$effect(() => {
		const mode = channel === 'onsite' ? 'pet-onsite' : 'pet-public';
		for (const pet of petItems) {
			if (!pet.image_url || pet.previewUrl) continue;
			const id = pet.image_url;
			void resolvePhotoPreviewUrl(id, mode).then((url) => {
				const target = petItems.find((p) => p.id === pet.id && p.image_url === id);
				if (target && url) {
					target.previewUrl = url;
					petItems = [...petItems];
				}
			});
		}
	});

	onDestroy(() => {
		// Cached preview blobs are kept for remount; drop only unbound local blobs.
		for (const p of petItems) {
			if (p.previewUrl?.startsWith('blob:') && !p.image_url) {
				URL.revokeObjectURL(p.previewUrl);
			}
		}
	});

	function addPet(species: 'dog' | 'cat' | 'other') {
		if (pending) return;
		if (petItems.length >= 20) {
			toast.error(t.petMaxReached);
			return;
		}
		const maxExisting = petItems.reduce((m, p) => Math.max(m, p.id), 0);
		const id = Math.max(nextPetId, maxExisting + 1);
		nextPetId = id + 1;
		petItems = [...petItems, createPetCard(species, id)];
		notifySync();
	}

	function removePet(id: number) {
		if (pending) return;
		const removed = petItems.find((p) => p.id === id);
		if (removed) {
			forgetPhotoPreview(removed.image_url);
			revokePetPreview(removed);
		}
		petItems = petItems.filter((p) => p.id !== id);
		notifySync();
	}

	async function onPetPhotoChange(petId: number, e: Event) {
		if (pending || !showPetPhotoUpload) return;
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const pet = petItems.find((p) => p.id === petId);
		if (!pet) return;

		if (pet.species === 'other' && !isMeaningfulOtherPetNotes(pet.customSpecies)) {
			toast.error(t.petSpeciesRequiredBeforePhoto);
			return;
		}

		uploadingPetId = petId;
		try {
			const localPreview = URL.createObjectURL(file);
			let photoId: string;
			if (channel === 'onsite') {
				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};
				const res = await saveImage.mutateAsync({ file, ctx });
				photoId = res._id;
			} else {
				const compressed = await compressImage(file);
				const contentType = compressed.full.type || 'image/webp';
				const filename = file.name || 'pet.webp';
				const form = new FormData();
				form.append('full', compressed.full, filename);
				form.append('thumb', compressed.thumbnail, 'thumb.webp');
				form.append('filename', filename);
				form.append('content_type', contentType);
				form.append('width', String(compressed.width));
				form.append('height', String(compressed.height));
				form.append('original_size', String(compressed.originalSize));
				form.append('compressed_size', String(compressed.compressedSize));
				form.append('thumbnail_size', String(compressed.thumbnailSize));
				const res = enableUnassignedPhoto
					? await uploadUnassignedPhoto(form)
					: await uploadShelterBookingPhoto(shelterCode.trim(), form);
				photoId = res.photo_id;
			}
			if (pet.image_url && pet.image_url !== photoId) {
				forgetPhotoPreview(pet.image_url);
			}
			revokePetPreview(pet);
			pet.previewUrl = localPreview;
			pet.image_url = photoId;
			rememberPhotoPreview(photoId, localPreview);
			notifySync();
			toast.success(t.petPhotoUploadOk);
		} catch {
			toast.error(t.petPhotoUploadFail);
		} finally {
			uploadingPetId = null;
		}
	}

	function clearPetPhoto(petId: number) {
		if (pending || uploadingPetId === petId) return;
		const pet = petItems.find((p) => p.id === petId);
		if (!pet) return;
		forgetPhotoPreview(pet.image_url);
		revokePetPreview(pet);
		pet.image_url = null;
		notifySync();
	}

	function petTitle(item: PetCardItem): string {
		return getPetTitle(item, petItems, {
			dogTitle: t.dogTitle,
			catTitle: t.catTitle,
			otherPetTitle: t.otherPetTitle,
			petIndexSuffix: t.petIndexSuffix
		});
	}
</script>

<UnifiedRegistrationSection
	id="unified-pets"
	title={t.sectionPets}
	description={t.sectionPetsDesc}
	badge={totalPetCount > 0 ? `${totalPetCount}${t.petCountUnit ? ` ${t.petCountUnit}` : ''}` : null}
	icon={PawPrint}
	bodyClass="none"
>
	{#snippet actions()}
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={pending || petItems.length >= 20}
			onclick={() => addPet('dog')}
			class="h-8 gap-1 text-xs"
		>
			<Plus class="size-3.5" />
			{t.addDog}
		</Button>
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={pending || petItems.length >= 20}
			onclick={() => addPet('cat')}
			class="h-8 gap-1 text-xs"
		>
			<Plus class="size-3.5" />
			{t.addCat}
		</Button>
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={pending || petItems.length >= 20}
			onclick={() => addPet('other')}
			class="h-8 gap-1 text-xs"
		>
			<Plus class="size-3.5" />
			{t.addOtherPet}
		</Button>
	{/snippet}

	{#if petItems.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/80 bg-white p-4 text-center"
		>
			<PawPrint class="size-6 text-muted-foreground/50" />
			<p class="text-sm font-medium text-foreground">{t.sectionPetsEmpty}</p>
			<p class="text-xs text-muted-foreground">{t.sectionPetsEmptyHint}</p>
			<div class="mt-1 flex flex-wrap justify-center gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || petItems.length >= 20}
					onclick={() => addPet('dog')}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" />
					{t.addDogFull}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || petItems.length >= 20}
					onclick={() => addPet('cat')}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" />
					{t.addCatFull}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || petItems.length >= 20}
					onclick={() => addPet('other')}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" />
					{t.addOtherPetFull}
				</Button>
			</div>
		</div>
	{:else}
		<div class="space-y-2">
			{#each petItems as pet (pet.id)}
				<div class="rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-2xs sm:p-3">
					<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
						<div class="flex min-w-0 items-center gap-2">
							<span
								class="inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold
								{pet.species === 'dog'
									? 'border-amber-200 bg-amber-50 text-amber-900'
									: pet.species === 'cat'
										? 'border-sky-200 bg-sky-50 text-sky-900'
										: 'border-emerald-200 bg-emerald-50 text-emerald-900'}"
							>
								{pet.species === 'dog'
									? t.dogTitle
									: pet.species === 'cat'
										? t.catTitle
										: t.otherPetTitle}
							</span>
							<span class="truncate text-sm font-semibold text-foreground">
								{petTitle(pet)}
							</span>
						</div>

						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={pending}
							onclick={() => removePet(pet.id)}
							class="h-7 shrink-0 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
						>
							<Trash2 class="mr-1 size-3.5" />
							{t.removeBtn}
						</Button>
					</div>

					<div
						class="flex flex-col gap-2.5 {showPetPhotoUpload ? 'sm:flex-row sm:items-start' : ''}"
					>
						{#if showPetPhotoUpload}
							<div class="flex shrink-0 items-start gap-2 sm:w-[7.5rem] sm:flex-col">
								<div
									class="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30 sm:size-16"
								>
									{#if uploadingPetId === pet.id}
										<Loader2 class="size-5 animate-spin text-primary" />
									{:else if pet.previewUrl}
										<img
											src={pet.previewUrl}
											alt={t.petPhotoLabel}
											class="size-full object-cover"
										/>
									{:else}
										<Camera class="size-5 text-muted-foreground/50" />
									{/if}
								</div>
								<div
									class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:w-full sm:flex-col sm:items-stretch"
								>
									<label
										for="pet-photo-{pet.id}"
										class="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted {pending ||
										uploadingPetId === pet.id
											? 'pointer-events-none opacity-60'
											: ''}"
									>
										<Camera class="size-3.5 text-primary" />
										<span class="truncate">
											{pet.previewUrl || pet.image_url ? t.petPhotoChange : t.petPhotoPick}
										</span>
									</label>
									<input
										id="pet-photo-{pet.id}"
										type="file"
										accept="image/*"
										class="sr-only"
										disabled={pending || uploadingPetId === pet.id}
										onchange={(e) => void onPetPhotoChange(pet.id, e)}
									/>
									{#if pet.previewUrl || pet.image_url}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={pending || uploadingPetId === pet.id}
											onclick={() => clearPetPhoto(pet.id)}
											class="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
											aria-label={t.petPhotoRemove}
										>
											<X class="size-3.5" />
											{t.petPhotoRemove}
										</Button>
									{/if}
								</div>
							</div>
						{/if}

						<div class="min-w-0 flex-1 space-y-2">
							<div class="grid grid-cols-1 gap-2 {pet.species === 'other' ? 'sm:grid-cols-2' : ''}">
								{#if pet.species === 'other'}
									<div class="space-y-1">
										<Label class="text-xs font-semibold text-foreground">
											{t.petSpeciesCustomLabel} <span class="text-destructive">*</span>
										</Label>
										<Input
											placeholder={t.petSpeciesCustomPlaceholder}
											bind:value={pet.customSpecies}
											disabled={pending}
											class="h-8 text-sm"
											oninput={notifySync}
										/>
									</div>
								{/if}

								<div class="space-y-1">
									<Label class="text-xs font-semibold text-foreground">
										{t.petNameLabel}
									</Label>
									<Input
										placeholder={t.petNamePlaceholder}
										bind:value={pet.name}
										disabled={pending}
										class="h-8 text-sm"
										oninput={notifySync}
									/>
								</div>
							</div>

							<div class="space-y-1">
								<Label class="text-xs font-semibold text-foreground">
									{t.petExtraLabel}
								</Label>
								<Textarea
									placeholder={t.petExtraPlaceholder}
									bind:value={pet.details}
									disabled={pending}
									rows={1}
									class="min-h-9 resize-y text-sm"
									oninput={notifySync}
								/>
							</div>

							<label
								class="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground select-none"
							>
								<Checkbox
									checked={pet.has_cage}
									onCheckedChange={(v) => {
										pet.has_cage = v === true;
										notifySync();
									}}
									disabled={pending}
									class="size-4"
								/>
								<span>{t.petHasCage}</span>
							</label>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</UnifiedRegistrationSection>
