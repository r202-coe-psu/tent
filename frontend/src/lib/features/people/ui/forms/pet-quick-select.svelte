<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Camera from '@lucide/svelte/icons/camera';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useSaveImage } from '$lib/features/images';
	import type { PetGroup } from '../../domain/people';
	import { togglePetSpecies } from '../../domain/unified-registration';

	let {
		pets = $bindable<PetGroup[]>([]),
		disabled = false
	}: {
		pets?: PetGroup[];
		disabled?: boolean;
	} = $props();

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

	let otherNotes = $state('');
	let otherDraftOpen = $state(false);
	let uploadingPhoto = $state(false);

	const hasDog = $derived(pets.some((p) => p.species === 'dog'));
	const hasCat = $derived(pets.some((p) => p.species === 'cat'));
	const otherPet = $derived(pets.find((p) => p.species === 'other'));
	const showOtherInput = $derived(otherDraftOpen || Boolean(otherPet));

	function chipClass(active: boolean): string {
		return active
			? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
			: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5';
	}

	function toggleKnown(species: 'dog' | 'cat') {
		if (disabled) return;
		pets = togglePetSpecies(pets, species);
	}

	function toggleOther() {
		if (disabled) return;
		if (otherPet) {
			pets = togglePetSpecies(pets, 'other');
			otherDraftOpen = false;
			otherNotes = '';
			return;
		}
		otherDraftOpen = true;
		otherNotes = '';
		pets = togglePetSpecies(pets, 'other');
	}

	function commitOtherNotes() {
		if (disabled) return;
		const trimmed = otherNotes.trim() || otherPet?.notes?.trim() || '';
		const withoutOther = pets.filter((p) => p.species !== 'other');
		if (!trimmed) {
			pets = withoutOther;
			return;
		}
		pets = [
			...withoutOther,
			{
				species: 'other',
				count: 1,
				notes: trimmed,
				image_url: otherPet?.image_url ?? null
			}
		];
	}

	function setOtherPhoto(url: string | null) {
		if (disabled) return;
		const withoutOther = pets.filter((p) => p.species !== 'other');
		const notes = otherNotes.trim() || otherPet?.notes?.trim() || '';
		if (!notes && !url) {
			pets = withoutOther;
			return;
		}
		pets = [
			...withoutOther,
			{
				species: 'other',
				count: 1,
				notes: notes || 'อื่นๆ',
				image_url: url
			}
		];
	}

	async function onPhotoChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || disabled) return;

		uploadingPhoto = true;
		try {
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};
			const res = await saveImage.mutateAsync({ file, ctx });
			setOtherPhoto(res._id);
			toast.success('อัปโหลดรูปสัตว์เลี้ยงแล้ว');
		} catch {
			toast.error('อัปโหลดรูปไม่สำเร็จ');
		} finally {
			uploadingPhoto = false;
		}
	}
</script>

<div class="space-y-3">
	<div>
		<h4 class="text-sm font-semibold text-foreground">สัตว์เลี้ยง</h4>
		<p class="text-xs text-muted-foreground">เลือกชนิดสัตว์ที่นำมาด้วย (ใช้ร่วมทั้งครอบครัว)</p>
	</div>

	<div class="flex flex-wrap gap-2">
		<Button
			type="button"
			variant="outline"
			{disabled}
			onclick={() => toggleKnown('dog')}
			class="h-auto rounded-md border px-3 py-2 text-sm {chipClass(hasDog)}"
		>
			สุนัข
		</Button>
		<Button
			type="button"
			variant="outline"
			{disabled}
			onclick={() => toggleKnown('cat')}
			class="h-auto rounded-md border px-3 py-2 text-sm {chipClass(hasCat)}"
		>
			แมว
		</Button>
		<Button
			type="button"
			variant="outline"
			{disabled}
			onclick={toggleOther}
			class="h-auto rounded-md border px-3 py-2 text-sm {chipClass(Boolean(otherPet))}"
		>
			อื่นๆ
		</Button>
	</div>

	{#if showOtherInput}
		<div class="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
			<Label for="pet-other-notes" class="text-xs font-semibold text-foreground">
				ระบุชนิดสัตว์ <span class="text-destructive">*</span>
			</Label>
			<Input
				id="pet-other-notes"
				value={otherNotes || otherPet?.notes || ''}
				oninput={(e) => {
					otherNotes = (e.currentTarget as HTMLInputElement).value;
				}}
				onblur={commitOtherNotes}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						commitOtherNotes();
					}
				}}
				{disabled}
				placeholder="เช่น ลิง กระต่าย"
				class="h-9"
			/>
			<div class="flex items-center gap-2">
				<label
					class="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground {disabled ||
					uploadingPhoto
						? 'pointer-events-none opacity-50'
						: ''}"
				>
					<Camera class="size-3.5" />
					<span>{uploadingPhoto ? 'กำลังอัปโหลด…' : 'แนบรูป'}</span>
					<input
						type="file"
						accept="image/*"
						class="sr-only"
						disabled={disabled || uploadingPhoto}
						onchange={onPhotoChange}
					/>
				</label>
				{#if otherPet?.image_url}
					<span class="truncate text-2xs text-muted-foreground">{otherPet.image_url}</span>
					<button
						type="button"
						class="cursor-pointer text-muted-foreground hover:text-foreground"
						{disabled}
						aria-label="ลบรูปสัตว์เลี้ยง"
						onclick={() => setOtherPhoto(null)}
					>
						<X class="size-3.5" />
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
