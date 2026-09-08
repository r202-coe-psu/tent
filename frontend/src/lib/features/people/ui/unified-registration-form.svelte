<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import HouseholdAddressFields from './forms/household-address-fields.svelte';
	import UnifiedRegistrationMemberCard from './unified-registration-member-card.svelte';
	import {
		blankUnifiedMember,
		unifiedRegistrationInputSchema,
		type UnifiedRegistrationChannel,
		type UnifiedRegistrationInput
	} from '../domain/unified-registration';
	import type { HouseholdVehicle, PetGroup } from '../domain/people';

	let {
		channel = 'onsite',
		pending = false,
		submitLabel,
		stickyTopOffset,
		onsubmit,
		onDirtyChange,
		children
	}: {
		channel?: UnifiedRegistrationChannel;
		pending?: boolean;
		submitLabel?: string;
		stickyTopOffset?: string;
		onsubmit: (input: UnifiedRegistrationInput) => Promise<void> | void;
		onDirtyChange?: (dirty: boolean) => void;
		children?: import('svelte').Snippet<[{ household: UnifiedRegistrationInput['household'] }]>;
	} = $props();

	const effectiveStickyTop = $derived(
		stickyTopOffset ?? (channel === 'onsite' ? 'top-[108px]' : 'top-16')
	);

	let members = $state<UnifiedRegistrationInput['members']>([blankUnifiedMember()]);
	let household = $state<UnifiedRegistrationInput['household']>({
		housing_type: 'owned_house',
		residence_landmark: null,
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: '',
		pets: [] as PetGroup[],
		vehicles: [] as HouseholdVehicle[],
		assets: null
	});
	let assetDescription = $state('');
	let formError = $state<string | null>(null);
	let touched = $state(false);

	interface PetCardItem {
		id: number;
		species: 'dog' | 'cat' | 'other';
		customSpecies: string;
		name: string;
		details: string;
		has_cage: boolean;
	}

	let nextPetId = 1;

	function parseInitialPets(pets: PetGroup[]): PetCardItem[] {
		const result: PetCardItem[] = [];
		for (const p of pets ?? []) {
			const count = Math.max(1, Number(p.count) || 1);
			for (let i = 0; i < count; i++) {
				const notes = p.notes ?? '';
				const parts = notes
					.split('|')
					.map((s) => s.trim())
					.filter(Boolean);
				let customSpecies = '';
				let name = '';
				const detailsList: string[] = [];

				for (const part of parts) {
					if (part.startsWith('ชื่อ:')) {
						name = part.replace(/^ชื่อ:\s*/, '').trim();
					} else if (p.species === 'other' && !customSpecies) {
						customSpecies = part;
					} else {
						detailsList.push(part);
					}
				}

				result.push({
					id: nextPetId++,
					species: p.species,
					customSpecies: p.species === 'other' ? customSpecies || notes : '',
					name,
					details: detailsList.join(' | '),
					has_cage: p.has_cage ?? false
				});
			}
		}
		return result;
	}

	let petItems = $state<PetCardItem[]>(parseInitialPets(household.pets as PetGroup[]));
	const totalPetCount = $derived(petItems.length);

	function syncPetsToHousehold() {
		household.pets = petItems.map((p) => {
			const notesParts: string[] = [];
			if (p.species === 'other' && p.customSpecies.trim()) {
				notesParts.push(p.customSpecies.trim());
			}
			if (p.name.trim()) {
				notesParts.push(`ชื่อ: ${p.name.trim()}`);
			}
			if (p.details.trim()) {
				notesParts.push(p.details.trim());
			}
			const notes =
				notesParts.length > 0
					? notesParts.join(' | ')
					: p.species === 'other'
						? p.customSpecies.trim()
						: undefined;
			return {
				species: p.species,
				count: 1,
				notes,
				has_cage: p.has_cage,
				image_url: null
			};
		});
		markDirty();
	}

	$effect(() => {
		onDirtyChange?.(touched);
	});

	function markDirty() {
		touched = true;
	}

	function addMember() {
		if (pending) return;
		members = [...members, blankUnifiedMember()];
		markDirty();
	}

	function removeMember(index: number) {
		if (pending || index === 0 || members.length <= 1) return;
		members = members.filter((_, i) => i !== index);
		markDirty();
	}

	function addPet(species: 'dog' | 'cat' | 'other') {
		if (pending) return;
		if (petItems.length >= 20) {
			toast.error('สามารถบันทึกสัตว์เลี้ยงได้สูงสุด 20 ตัว');
			return;
		}
		petItems = [
			...petItems,
			{
				id: nextPetId++,
				species,
				customSpecies: '',
				name: '',
				details: '',
				has_cage: false
			}
		];
		syncPetsToHousehold();
	}

	function removePet(id: number) {
		if (pending) return;
		petItems = petItems.filter((p) => p.id !== id);
		syncPetsToHousehold();
	}

	function getPetTitle(item: PetCardItem): string {
		const sameSpecies = petItems.filter((p) => p.species === item.species);
		const indexInSpecies = sameSpecies.findIndex((p) => p.id === item.id) + 1;
		if (item.species === 'dog') {
			return `สุนัข — ตัวที่ ${indexInSpecies}`;
		}
		if (item.species === 'cat') {
			return `แมว — ตัวที่ ${indexInSpecies}`;
		}
		const label = item.customSpecies.trim() ? item.customSpecies.trim() : 'สัตว์อื่นๆ';
		return `${label} — ตัวที่ ${indexInSpecies}`;
	}

	function addVehicle() {
		if (pending) return;
		household.vehicles = [...(household.vehicles ?? []), { type: 'car', license_plate: '' }];
		markDirty();
	}

	function removeVehicle(index: number) {
		if (pending) return;
		household.vehicles = (household.vehicles ?? []).filter((_, i) => i !== index);
		markDirty();
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (pending) return;

		for (const p of petItems) {
			if (p.species === 'other' && !p.customSpecies.trim()) {
				formError = 'กรุณาระบุชนิดสัตว์สำหรับสัตว์เลี้ยงอื่นๆ';
				toast.error(formError);
				return;
			}
		}
		syncPetsToHousehold();

		const payload: UnifiedRegistrationInput = {
			members,
			household: {
				...household,
				vehicles: channel === 'onsite' ? (household.vehicles ?? []) : [],
				assets:
					channel === 'onsite' && assetDescription.trim()
						? { description: assetDescription.trim(), image_url: null }
						: null
			}
		};

		const result = unifiedRegistrationInputSchema.safeParse(payload);
		if (!result.success) {
			const first = result.error.issues[0];
			formError = first?.message ?? 'กรุณากรอกข้อมูลให้ครบถ้วน';
			toast.error(formError);
			return;
		}

		if (channel === 'public') {
			const headPhone = members[0]?.phone?.trim();
			if (!headPhone || !/^0\d{8,9}$/.test(headPhone.replace(/[-\s]/g, ''))) {
				formError = 'กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก';
				toast.error(formError);
				return;
			}
		}

		formError = null;
		try {
			await onsubmit(result.data as UnifiedRegistrationInput);
			touched = false;
		} catch {
			// Caller surfaces save errors.
		}
	}
</script>

<form class="space-y-6" onsubmit={handleSubmit} oninput={markDirty}>
	<!-- ── Section 1: ข้อมูลที่อยู่อาศัย ─────────────────────────────────── -->
	<section class="space-y-3">
		<div
			class="sticky z-20 {effectiveStickyTop} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/95 p-3.5 shadow-xs backdrop-blur-md sm:p-4"
		>
			<div class="flex items-center gap-2.5">
				<Home class="size-5 text-primary" />
				<div>
					<h2 class="text-base font-bold text-foreground">ข้อมูลที่อยู่อาศัย</h2>
					<p class="text-xs text-muted-foreground">ประเภทที่อยู่อาศัย และที่อยู่เดิมของครอบครัว</p>
				</div>
			</div>
		</div>

		<div class="rounded-xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
			<HouseholdAddressFields
				bind:housing_type={household.housing_type}
				bind:residence_landmark={
					() => household.residence_landmark ?? '',
					(v) => {
						household.residence_landmark = v || null;
					}
				}
				bind:address_no={
					() => household.address_no ?? '',
					(v) => {
						household.address_no = v;
					}
				}
				bind:village_no={
					() => household.village_no ?? '',
					(v) => {
						household.village_no = v;
					}
				}
				bind:subdistrict={
					() => household.subdistrict ?? '',
					(v) => {
						household.subdistrict = v;
					}
				}
				bind:district={
					() => household.district ?? '',
					(v) => {
						household.district = v;
					}
				}
				bind:province={
					() => household.province ?? '',
					(v) => {
						household.province = v;
					}
				}
				bind:postal_code={
					() => household.postal_code ?? '',
					(v) => {
						household.postal_code = v;
					}
				}
				required={true}
				disabled={pending}
			/>
		</div>
	</section>

	<!-- ── Section 2: สัตว์เลี้ยง ────────────────────────────────────────── -->
	<section class="space-y-3">
		<div
			class="sticky z-20 {effectiveStickyTop} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/95 p-3.5 shadow-xs backdrop-blur-md sm:p-4"
		>
			<div class="flex items-center gap-2.5">
				<PawPrint class="size-5 text-primary" />
				<div>
					<div class="flex items-center gap-2">
						<h2 class="text-base font-bold text-foreground">สัตว์เลี้ยง</h2>
						{#if totalPetCount > 0}
							<span
								class="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
							>
								{totalPetCount} ตัว
							</span>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground">สัตว์เลี้ยงที่นำมาด้วย (ใช้ร่วมทั้งครอบครัว)</p>
				</div>
			</div>

			<div class="flex flex-wrap items-center gap-1.5">
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || petItems.length >= 20}
					onclick={() => addPet('dog')}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" /> สุนัข
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || petItems.length >= 20}
					onclick={() => addPet('cat')}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" /> แมว
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending || petItems.length >= 20}
					onclick={() => addPet('other')}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" /> สัตว์อื่นๆ
				</Button>
			</div>
		</div>

		<div class="rounded-xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
			{#if petItems.length === 0}
				<div
					class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-6 text-center"
				>
					<PawPrint class="size-8 text-muted-foreground/50" />
					<p class="text-sm font-medium text-foreground">ยังไม่มีการบันทึกสัตว์เลี้ยง</p>
					<p class="text-xs text-muted-foreground">
						หากนำสัตว์เลี้ยงมาด้วย สามารถกดปุ่มเพิ่มสัตว์เลี้ยงด้านบน หรือเลือกจากปุ่มด้านล่างนี้
					</p>
					<div class="mt-2 flex flex-wrap justify-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending || petItems.length >= 20}
							onclick={() => addPet('dog')}
							class="h-8 gap-1 text-xs"
						>
							<Plus class="size-3.5" /> เพิ่มสุนัข
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending || petItems.length >= 20}
							onclick={() => addPet('cat')}
							class="h-8 gap-1 text-xs"
						>
							<Plus class="size-3.5" /> เพิ่มแมว
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={pending || petItems.length >= 20}
							onclick={() => addPet('other')}
							class="h-8 gap-1 text-xs"
						>
							<Plus class="size-3.5" /> เพิ่มสัตว์อื่นๆ
						</Button>
					</div>
				</div>
			{:else}
				<div class="space-y-3">
					{#each petItems as pet (pet.id)}
						<div class="space-y-3 rounded-lg border border-border/60 bg-slate-50/50 p-3 sm:p-4">
							<div
								class="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2"
							>
								<div class="flex items-center gap-2">
									<span
										class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold
										{pet.species === 'dog'
											? 'border-amber-200 bg-amber-50 text-amber-900'
											: pet.species === 'cat'
												? 'border-sky-200 bg-sky-50 text-sky-900'
												: 'border-emerald-200 bg-emerald-50 text-emerald-900'}"
									>
										{pet.species === 'dog' ? 'สุนัข' : pet.species === 'cat' ? 'แมว' : 'สัตว์อื่นๆ'}
									</span>
									<span class="text-sm font-bold text-foreground">
										{getPetTitle(pet)}
									</span>
								</div>

								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={pending}
									onclick={() => removePet(pet.id)}
									class="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
								>
									<Trash2 class="mr-1 size-3.5" />
									ลบ
								</Button>
							</div>

							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								{#if pet.species === 'other'}
									<div class="space-y-1">
										<Label class="text-2xs font-medium text-muted-foreground">
											ชนิดสัตว์ <span class="text-destructive">*</span>
										</Label>
										<Input
											placeholder="เช่น นกแก้ว, กระต่าย, ชูก้าไรเดอร์"
											bind:value={pet.customSpecies}
											disabled={pending}
											class="h-8 text-xs"
											oninput={syncPetsToHousehold}
										/>
									</div>
								{/if}

								<div class="space-y-1 {pet.species !== 'other' ? 'sm:col-span-2' : ''}">
									<Label class="text-2xs font-medium text-muted-foreground">
										ชื่อสัตว์เลี้ยง (ถ้ามี)
									</Label>
									<Input
										placeholder="เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้"
										bind:value={pet.name}
										disabled={pending}
										class="h-8 text-xs"
										oninput={syncPetsToHousehold}
									/>
								</div>

								<div class="space-y-1 sm:col-span-2">
									<Label class="text-2xs font-medium text-muted-foreground">
										อาการ / สายพันธุ์ / ข้อมูลเพิ่มเติม
									</Label>
									<Textarea
										placeholder="เช่น มีโรคประจำตัว, สายพันธุ์บางแก้ว, ทานอาหารเปียก, ต้องทานยาทุกเช้า"
										bind:value={pet.details}
										disabled={pending}
										rows={2}
										class="min-h-16 text-xs"
										oninput={syncPetsToHousehold}
									/>
								</div>

								<div class="flex items-center pt-1 sm:col-span-2">
									<label
										class="flex cursor-pointer items-center gap-2 text-xs text-foreground select-none"
									>
										<Checkbox
											checked={pet.has_cage}
											onCheckedChange={(v) => {
												pet.has_cage = v === true;
												syncPetsToHousehold();
											}}
											disabled={pending}
											class="size-4"
										/>
										<span>มีกรง / สายจูง / ตะกร้า</span>
									</label>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<!-- ── Section 3: ยานพาหนะและทรัพย์สิน (เฉพาะ Station 1 / Onsite) ──────── -->
	{#if channel === 'onsite'}
		<section class="space-y-3">
			<div
				class="sticky z-20 {effectiveStickyTop} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/95 p-3.5 shadow-xs backdrop-blur-md sm:p-4"
			>
				<div class="flex items-center gap-2.5">
					<Package class="size-5 text-primary" />
					<div>
						<div class="flex items-center gap-2">
							<h2 class="text-base font-bold text-foreground">ยานพาหนะและทรัพย์สิน</h2>
							{#if (household.vehicles ?? []).length > 0}
								<span
									class="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
								>
									{(household.vehicles ?? []).length} คัน
								</span>
							{/if}
						</div>
						<p class="text-xs text-muted-foreground">
							ยานพาหนะและทรัพย์สินมีค่าที่นำติดตัวมา (เฉพาะ Station 1)
						</p>
					</div>
				</div>

				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending}
					onclick={addVehicle}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" /> เพิ่มยานพาหนะ
				</Button>
			</div>

			<div class="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
				{#if (household.vehicles ?? []).length === 0}
					<p class="text-xs text-muted-foreground">
						ยังไม่มียานพาหนะ (กดปุ่มเพิ่มยานพาหนะด้านบนเพื่อบันทึก)
					</p>
				{:else}
					<div class="space-y-2">
						{#each household.vehicles ?? [] as vehicle, index (index)}
							<div
								class="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-slate-50/50 p-2.5"
							>
								<div class="w-[140px] shrink-0 space-y-1">
									<Label class="text-2xs text-muted-foreground">ประเภท</Label>
									<Select.Root
										type="single"
										value={vehicle.type}
										onValueChange={(val) => {
											if (val === 'car' || val === 'motorcycle' || val === 'other') {
												vehicle.type = val;
												household.vehicles = [...(household.vehicles ?? [])];
												markDirty();
											}
										}}
										disabled={pending}
									>
										<Select.Trigger class="!h-8 w-full rounded-md text-xs">
											{vehicle.type === 'car'
												? 'รถยนต์'
												: vehicle.type === 'motorcycle'
													? 'รถจักรยานยนต์'
													: 'อื่นๆ'}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="car" label="รถยนต์" />
											<Select.Item value="motorcycle" label="รถจักรยานยนต์" />
											<Select.Item value="other" label="อื่นๆ" />
										</Select.Content>
									</Select.Root>
								</div>
								<div class="min-w-[140px] flex-1 space-y-1">
									<Label class="text-2xs text-muted-foreground">ทะเบียนรถ</Label>
									<Input
										class="h-8"
										value={vehicle.license_plate ?? ''}
										disabled={pending}
										oninput={(e) => {
											vehicle.license_plate = (e.currentTarget as HTMLInputElement).value;
											household.vehicles = [...(household.vehicles ?? [])];
											markDirty();
										}}
									/>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={pending}
									onclick={() => removeVehicle(index)}
									class="h-8 text-xs text-destructive hover:text-destructive"
								>
									<Trash2 class="mr-1 size-3.5" />
									ลบ
								</Button>
							</div>
						{/each}
					</div>
				{/if}

				<div class="space-y-1.5 border-t border-border/60 pt-4">
					<Label for="family-assets" class="text-xs font-semibold text-foreground">
						ทรัพย์สินมีค่า
					</Label>
					<Textarea
						id="family-assets"
						bind:value={assetDescription}
						disabled={pending}
						rows={2}
						placeholder="เช่น เอกสารสำคัญ เครื่องใช้ไฟฟ้า สร้อยคอทองคำ"
						class="min-h-16 text-sm"
					/>
				</div>
			</div>
		</section>
	{/if}

	<!-- ── Section 4: สมาชิกในครอบครัว ─────────────────────────────────── -->
	<section class="space-y-3">
		<div
			class="sticky z-20 {effectiveStickyTop} flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/95 p-3.5 shadow-xs backdrop-blur-md sm:p-4"
		>
			<div class="flex items-center gap-2.5">
				<Users class="size-5 text-primary" />
				<div>
					<div class="flex items-center gap-2">
						<h2 class="text-base font-bold text-foreground">สมาชิกในครอบครัว</h2>
						<span
							class="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
						>
							{members.length} คน
						</span>
					</div>
					<p class="text-xs text-muted-foreground">
						ทุกคนกรอกข้อมูลเท่ากัน · คนแรกคือผู้ติดต่อหลัก
						{#if channel === 'onsite'}
							· สถานะหลังบันทึก arriving
						{/if}
					</p>
				</div>
			</div>

			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onclick={addMember}
				class="h-9 gap-1.5"
			>
				<Plus class="size-4" />
				เพิ่มสมาชิก
			</Button>
		</div>

		<div class="space-y-4">
			{#each [...members.keys()] as index (index)}
				<UnifiedRegistrationMemberCard
					bind:member={
						() => members[index]!,
						(v) => {
							members[index] = v;
							members = [...members];
						}
					}
					{index}
					canRemove={index > 0}
					disabled={pending}
					onRemove={() => removeMember(index)}
				/>
			{/each}
		</div>
	</section>

	{#if children}
		<div class="pt-2">
			{@render children({
				household: {
					...household,
					vehicles: channel === 'onsite' ? (household.vehicles ?? []) : [],
					assets:
						channel === 'onsite' && assetDescription.trim()
							? { description: assetDescription.trim(), image_url: null }
							: null
				}
			})}
		</div>
	{/if}

	{#if formError}
		<p class="text-sm text-destructive" role="alert">{formError}</p>
	{/if}

	<div
		class="sticky bottom-0 z-30 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur-sm"
	>
		<Button
			type="submit"
			disabled={pending}
			class="h-11 w-full gap-2 text-base font-semibold sm:w-auto sm:px-8"
		>
			{#if pending}
				<Loader2 class="size-4 animate-spin" />
				กำลังบันทึก…
			{:else}
				{submitLabel ??
					(channel === 'public' ? 'ยืนยันการลงทะเบียน' : 'บันทึกลงทะเบียนทั้งครอบครัว')}
			{/if}
		</Button>
	</div>
</form>
