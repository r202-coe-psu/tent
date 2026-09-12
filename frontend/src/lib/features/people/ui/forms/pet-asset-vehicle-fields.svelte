<script lang="ts">
	import Camera from '@lucide/svelte/icons/camera';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		isMeaningfulOtherPetNotes,
		type HouseholdVehicle,
		type PetGroup
	} from '$lib/features/people';
	import { useSaveImage } from '$lib/features/images';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { toast } from 'svelte-sonner';
	import EvacueePhoto from '../evacuee-photo.svelte';

	let {
		vehicles = $bindable<HouseholdVehicle[]>([]),
		valuables = $bindable<string>(''),
		pets = $bindable<PetGroup[]>([]),
		disabled = false
	}: {
		vehicles?: HouseholdVehicle[];
		valuables?: string;
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

	const vehicleTypeOptions = [
		{ value: 'car' as const, label: 'รถยนต์' },
		{ value: 'motorcycle' as const, label: 'รถจักรยานยนต์' },
		{ value: 'other' as const, label: 'อื่นๆ' }
	];

	const petSpeciesOptions = [
		{ value: 'dog' as const, label: 'สุนัข' },
		{ value: 'cat' as const, label: 'แมว' },
		{ value: 'other' as const, label: 'อื่นๆ' }
	];

	let uploadingPetIndex = $state<number | null>(null);
	let localPreviews = $state<Record<number, string>>({});

	function petPreviewSrc(imageUrl: string | null | undefined): string | null {
		const value = imageUrl?.trim();
		if (!value) return null;
		if (value.startsWith('http') || value.startsWith('blob:') || value.startsWith('data:')) {
			return value;
		}
		return null;
	}

	function addVehicle() {
		if (disabled) return;
		vehicles = [...vehicles, { type: 'car', license_plate: '' }];
	}

	function removeVehicle(index: number) {
		if (disabled) return;
		vehicles = vehicles.filter((_, i) => i !== index);
	}

	function addPet() {
		if (disabled) return;
		pets = [...pets, { species: 'dog', count: 1, notes: '', has_cage: false }];
	}

	function removePet(index: number) {
		if (disabled) return;
		if (localPreviews[index]?.startsWith('blob:')) {
			URL.revokeObjectURL(localPreviews[index]);
		}
		const newPreviews: Record<number, string> = {};
		for (const [k, v] of Object.entries(localPreviews)) {
			const keyNum = Number(k);
			if (keyNum < index) {
				newPreviews[keyNum] = v;
			} else if (keyNum > index) {
				newPreviews[keyNum - 1] = v;
			}
		}
		localPreviews = newPreviews;
		pets = pets.filter((_, i) => i !== index);
	}

	async function onPetPhotoChange(index: number, e: Event) {
		if (disabled || uploadingPetIndex === index) return;
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const pet = pets[index];
		if (!pet) return;

		if (pet.species === 'other' && !isMeaningfulOtherPetNotes(pet.notes)) {
			toast.error('กรุณาระบุชนิดสัตว์ในช่องหมายเหตุก่อนแนบรูป');
			return;
		}

		uploadingPetIndex = index;
		try {
			const previewUrl = URL.createObjectURL(file);
			if (localPreviews[index]?.startsWith('blob:')) {
				URL.revokeObjectURL(localPreviews[index]);
			}
			localPreviews[index] = previewUrl;

			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'unknown'
			};
			const res = await saveImage.mutateAsync({ file, ctx });
			pet.image_url = res._id;
			toast.success('อัปโหลดรูปสัตว์เลี้ยงแล้ว');
		} catch (err: unknown) {
			toast.error(`อัปโหลดรูปไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			uploadingPetIndex = null;
		}
	}

	function clearPetPhoto(index: number) {
		if (disabled || uploadingPetIndex === index) return;
		const pet = pets[index];
		if (!pet) return;
		if (localPreviews[index]?.startsWith('blob:')) {
			URL.revokeObjectURL(localPreviews[index]);
		}
		delete localPreviews[index];
		pet.image_url = null;
	}

	$effect(() => {
		return () => {
			for (const url of Object.values(localPreviews)) {
				if (url.startsWith('blob:')) {
					URL.revokeObjectURL(url);
				}
			}
		};
	});
</script>

<div class="space-y-6">
	<!-- Vehicles Section -->
	<div class="space-y-3">
		<div class="flex items-center justify-between border-b border-border pb-2">
			<div>
				<h4 class="text-sm font-semibold text-foreground">ข้อมูลยานพาหนะ (Vehicles)</h4>
				<p class="text-xs text-muted-foreground">ยานพาหนะที่นำมายังศูนย์พักพิง</p>
			</div>
			{#if !disabled}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={addVehicle}
					class="h-8 gap-1 text-xs text-primary"
				>
					<Plus class="size-3.5" /> เพิ่มคัน
				</Button>
			{/if}
		</div>

		{#if vehicles.length === 0}
			<p
				class="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground"
			>
				ไม่มียานพาหนะที่ลงทะเบียนไว้
			</p>
		{:else}
			<div class="space-y-2.5">
				{#each vehicles as vehicle, index (index)}
					<div class="flex items-end gap-2.5 rounded-lg border border-border/80 bg-muted/20 p-2.5">
						<div class="w-[140px] shrink-0 space-y-1">
							<Label class="text-2xs text-muted-foreground">ประเภทยานพาหนะ</Label>
							<Select.Root
								type="single"
								value={vehicle.type}
								onValueChange={(val) => {
									if (val === 'car' || val === 'motorcycle' || val === 'other') {
										vehicle.type = val;
									}
								}}
								{disabled}
							>
								<Select.Trigger class="!h-8 w-full rounded-md text-xs">
									{vehicleTypeOptions.find((o) => o.value === vehicle.type)?.label ?? 'เลือกประเภท'}
								</Select.Trigger>
								<Select.Content>
									{#each vehicleTypeOptions as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>

						<div class="flex-1 space-y-1">
							<Label class="text-2xs text-muted-foreground">เลขทะเบียนรถ</Label>
							<Input
								bind:value={vehicle.license_plate}
								{disabled}
								placeholder="เช่น กง 4567 สงขลา"
								class="h-8 text-xs"
							/>
						</div>

						{#if !disabled}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onclick={() => removeVehicle(index)}
								class="size-8 shrink-0 text-destructive hover:bg-destructive/10"
								aria-label="ลบยานพาหนะ"
							>
								<X class="size-4" />
							</Button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Valuables / Assets Section -->
	<div class="space-y-2 border-t border-border pt-4">
		<Label for="valuables-desc" class="text-sm font-semibold text-foreground">
			สัมภาระและสิ่งของมีค่า (Assets & Valuables)
		</Label>
		<Textarea
			id="valuables-desc"
			bind:value={valuables}
			{disabled}
			rows={2}
			placeholder="เช่น กระเป๋าเดินทาง 2 ใบ, คอมพิวเตอร์โน้ตบุ๊ก 1 เครื่อง, อุปกรณ์การแพทย์ส่วนตัว"
			class="text-xs"
		/>
	</div>

	<!-- Pets Section -->
	<div class="space-y-3 border-t border-border pt-4">
		<div class="flex items-center justify-between border-b border-border pb-2">
			<div>
				<h4 class="text-sm font-semibold text-foreground">สัตว์เลี้ยงที่นำมาด้วย (Pets)</h4>
				<p class="text-xs text-muted-foreground">
					บันทึกเพื่อการจัดสรรพื้นที่และการดูแลด้านสุขอนามัย
				</p>
			</div>
			{#if !disabled}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={addPet}
					class="h-8 gap-1 text-xs text-primary"
				>
					<Plus class="size-3.5" /> เพิ่มชนิดสัตว์เลี้ยง
				</Button>
			{/if}
		</div>

		{#if pets.length === 0}
			<p
				class="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground"
			>
				ไม่มีสัตว์เลี้ยงที่ลงทะเบียนไว้
			</p>
		{:else}
			<div class="space-y-2.5">
				{#each pets as pet, index (index)}
					{@const previewSrc = localPreviews[index] ?? petPreviewSrc(pet.image_url)}
					{@const photoDocId = previewSrc ? null : pet.image_url?.trim() || null}
					{@const hasPhoto = !!(previewSrc || photoDocId)}
					<div class="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-3.5">
						<div class="flex items-center justify-between border-b border-border/60 pb-2">
							<span class="text-xs font-semibold text-foreground">
								สัตว์เลี้ยงตัวที่ {index + 1} ({petSpeciesOptions.find((o) => o.value === pet.species)?.label ?? 'สัตว์เลี้ยง'})
							</span>
							{#if !disabled}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onclick={() => removePet(index)}
									class="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
									aria-label="ลบสัตว์เลี้ยง"
								>
									<X class="size-3.5" /> ลบ
								</Button>
							{/if}
						</div>

						<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
							<div class="space-y-1">
								<Label class="text-2xs text-muted-foreground">ชนิดสัตว์</Label>
								<Select.Root
									type="single"
									value={pet.species}
									onValueChange={(val) => {
										if (val === 'dog' || val === 'cat' || val === 'other') {
											pet.species = val;
										}
									}}
									{disabled}
								>
									<Select.Trigger class="!h-8 w-full rounded-md text-xs">
										{petSpeciesOptions.find((o) => o.value === pet.species)?.label ?? 'ชนิดสัตว์'}
									</Select.Trigger>
									<Select.Content>
										{#each petSpeciesOptions as opt (opt.value)}
											<Select.Item value={opt.value} label={opt.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>

							<div class="space-y-1">
								<Label class="text-2xs text-muted-foreground">จำนวน (ตัว)</Label>
								<Input
									type="number"
									min={1}
									bind:value={pet.count}
									{disabled}
									class="h-8 text-xs"
								/>
							</div>

							<div class="space-y-1">
								<Label class="text-2xs text-muted-foreground">
									หมายเหตุ {pet.species === 'other' ? '(ระบุชนิด *)' : ''}
								</Label>
								<Input
									bind:value={pet.notes}
									{disabled}
									placeholder={pet.species === 'other' ? 'เช่น กระต่าย, นก' : 'เช่น พันธุ์, ชื่อ'}
									class="h-8 text-xs"
								/>
							</div>

							<div class="flex items-center gap-2 pt-4">
								<Checkbox
									id={`pet-cage-${index}`}
									checked={pet.has_cage ?? false}
									onCheckedChange={(checked) => (pet.has_cage = !!checked)}
									{disabled}
								/>
								<Label for={`pet-cage-${index}`} class="cursor-pointer text-xs">มีกรง / สายจูง</Label>
							</div>
						</div>

						<!-- Photo Section -->
						<div class="space-y-1.5 border-t border-border/60 pt-2.5">
							<Label class="text-2xs font-medium text-muted-foreground">รูปสัตว์เลี้ยง (ถ้ามี)</Label>
							<div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
								{#if uploadingPetIndex === index}
									<div
										class="flex size-16 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30"
									>
										<Loader2 class="size-5 animate-spin text-primary" />
									</div>
								{:else if previewSrc}
									<div
										class="size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/30"
									>
										<img src={previewSrc} alt="รูปสัตว์เลี้ยง" class="size-full object-cover" />
									</div>
								{:else if photoDocId}
									<EvacueePhoto
										photoId={photoDocId}
										alt="รูปสัตว์เลี้ยง"
										size="md"
										class="rounded-xl border-border"
									/>
								{:else}
									<div
										class="flex size-16 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30"
									>
										<Camera class="size-6 text-muted-foreground/50" />
									</div>
								{/if}

								<div class="flex flex-wrap items-center gap-2">
									<label
										for="pet-photo-{index}"
										class="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted {disabled ||
										uploadingPetIndex === index
											? 'pointer-events-none opacity-60'
											: ''}"
									>
										<Camera class="size-3.5 text-primary" />
										<span>
											{hasPhoto ? 'เปลี่ยนภาพ' : 'ถ่าย / แนบรูปภาพ'}
										</span>
									</label>
									<input
										id="pet-photo-{index}"
										type="file"
										accept="image/*"
										class="sr-only"
										disabled={disabled || uploadingPetIndex === index}
										onchange={(e) => void onPetPhotoChange(index, e)}
									/>
									{#if hasPhoto}
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={disabled || uploadingPetIndex === index}
											onclick={() => clearPetPhoto(index)}
											class="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
											aria-label="ลบรูป"
										>
											<X class="size-3.5" />
											ลบรูป
										</Button>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
