<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Camera from '@lucide/svelte/icons/camera';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { CardType, Evacuee, Gender, Religion } from '$lib/features/people';
	import { imageRepository } from '$lib/features/images';
	import { COUNTRIES } from '$lib/utils/country';

	export type EvacueePersonalEditData = {
		firstName: string;
		lastName: string;
		nickname: string;
		birthYear: number | undefined;
		age: number | undefined;
		gender: Gender;
		phone: string | null;
		cardType: CardType;
		cardNumber: string;
		country: string;
		religion: Religion;
		photoFile: File | null;
		removePhoto: boolean;
	};

	let {
		show,
		evacuee,
		onClose,
		onSave
	}: {
		show: boolean;
		evacuee: Evacuee;
		onClose: () => void;
		onSave: (data: EvacueePersonalEditData) => Promise<void>;
	} = $props();

	const cardTypeOptions: { value: CardType; label: string }[] = [
		{ value: 'national_id', label: 'เลขประจำตัวประชาชน' },
		{ value: 'passport', label: 'หนังสือเดินทาง' },
		{ value: 'pink_card', label: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย' },
		{ value: 'other', label: 'บัตรประเภทอื่น' }
	];
	const genderOptions: { value: Gender; label: string }[] = [
		{ value: 'male', label: 'ชาย' },
		{ value: 'female', label: 'หญิง' },
		{ value: 'other', label: 'อื่นๆ' }
	];
	const religionOptions: { value: Religion; label: string }[] = [
		{ value: 'buddhist', label: 'พุทธ' },
		{ value: 'muslim', label: 'อิสลาม' },
		{ value: 'christian', label: 'คริสต์' },
		{ value: 'other', label: 'อื่นๆ' },
		{ value: 'unknown', label: 'ไม่ระบุ' }
	];

	const currentYearBE = new Date().getFullYear() + 543;
	const minimumBirthYearBE = currentYearBE - 150;
	const initial = untrack(() => ({
		firstName: evacuee.first_name,
		lastName: evacuee.last_name,
		nickname: evacuee.nickname ?? '',
		birthYear: evacuee.birth_year?.toString() ?? '',
		age:
			evacuee.age?.toString() ??
			(evacuee.birth_year ? String(Math.max(0, currentYearBE - evacuee.birth_year)) : ''),
		gender: evacuee.gender,
		phone: evacuee.phone ?? '',
		noPhone: !evacuee.phone,
		cardType: evacuee.person_id?.cardType ?? 'national_id',
		cardNumber: evacuee.person_id?.number ?? '',
		country: evacuee.country || 'THAILAND',
		religion: evacuee.religion ?? 'unknown'
	}));

	let firstName = $state(initial.firstName);
	let lastName = $state(initial.lastName);
	let nickname = $state(initial.nickname);
	let birthYear = $state(initial.birthYear);
	let age = $state(initial.age);
	let gender = $state<Gender>(initial.gender);
	let phone = $state(initial.phone);
	let noPhone = $state(initial.noPhone);
	let cardType = $state<CardType>(initial.cardType);
	let cardNumber = $state(initial.cardNumber);
	let country = $state(initial.country);
	let religion = $state<Religion>(initial.religion);
	let photoFile = $state<File | null>(null);
	let removePhoto = $state(false);
	let storedPhotoUrl = $state<string | null>(null);
	let selectedPhotoUrl = $state<string | null>(null);
	let saving = $state(false);

	$effect(() => {
		const photoId = evacuee.photo;
		let cancelled = false;
		let objectUrl: string | null = null;
		if (photoId) {
			imageRepository()
				.getThumbnailUrl(photoId)
				.then((url) => {
					if (cancelled) {
						if (url) URL.revokeObjectURL(url);
						return;
					}
					objectUrl = url;
					storedPhotoUrl = url;
				});
		}
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	$effect(() => {
		const file = photoFile;
		if (!file) {
			selectedPhotoUrl = null;
			return;
		}
		const url = URL.createObjectURL(file);
		selectedPhotoUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	function digits(value: string): string {
		return value.replace(/\D/g, '');
	}

	function selectPhoto(file: File | null) {
		photoFile = file;
		if (file) removePhoto = false;
	}

	function clearPhoto() {
		photoFile = null;
		removePhoto = true;
	}

	function updateAge(value: string) {
		age = digits(value).slice(0, 3);
		const parsed = Number.parseInt(age, 10);
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 150) {
			birthYear = String(currentYearBE - parsed);
		}
	}

	function updateBirthYear(value: string) {
		birthYear = digits(value).slice(0, 4);
		const parsed = Number.parseInt(birthYear, 10);
		if (Number.isFinite(parsed) && parsed <= currentYearBE) {
			const calculatedAge = currentYearBE - parsed;
			if (calculatedAge >= 0 && calculatedAge <= 150) age = String(calculatedAge);
		}
	}

	async function save() {
		if (!firstName.trim() || !lastName.trim()) {
			toast.error('กรุณากรอกชื่อและนามสกุล');
			return;
		}
		if (!noPhone && digits(phone).length !== 10) {
			toast.error('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือกไม่มีเบอร์โทร');
			return;
		}
		if (cardType === 'national_id' && cardNumber && digits(cardNumber).length !== 13) {
			toast.error('เลขประจำตัวประชาชนต้องมี 13 หลัก');
			return;
		}

		const parsedAge = age ? Number.parseInt(age, 10) : undefined;
		const parsedBirthYear = birthYear ? Number.parseInt(birthYear, 10) : undefined;
		if (
			parsedAge !== undefined &&
			(!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 150)
		) {
			toast.error('อายุต้องอยู่ระหว่าง 0 ถึง 150 ปี');
			return;
		}
		if (
			parsedBirthYear !== undefined &&
			(!Number.isFinite(parsedBirthYear) ||
				parsedBirthYear <= minimumBirthYearBE ||
				parsedBirthYear > currentYearBE)
		) {
			toast.error(`ปีเกิดต้องมากกว่า พ.ศ. ${minimumBirthYearBE} และไม่เกินปีปัจจุบัน`);
			return;
		}
		if (
			parsedBirthYear !== undefined &&
			parsedAge !== undefined &&
			currentYearBE - parsedBirthYear !== parsedAge
		) {
			toast.error('ปีเกิดและอายุไม่สัมพันธ์กัน');
			return;
		}

		saving = true;
		try {
			await onSave({
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				nickname: nickname.trim(),
				birthYear: parsedBirthYear,
				age: parsedAge,
				gender,
				phone: noPhone ? null : digits(phone),
				cardType,
				cardNumber: cardType === 'national_id' ? digits(cardNumber) : cardNumber.trim(),
				country,
				religion,
				photoFile,
				removePhoto
			});
		} finally {
			saving = false;
		}
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="personal-modal-title"
			class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
		>
			<header class="flex items-start justify-between border-b border-border px-5 py-4">
				<div>
					<h3 id="personal-modal-title" class="text-base font-bold text-foreground">
						แก้ไขข้อมูลส่วนบุคคล
					</h3>
					<p class="mt-1 text-xs text-muted-foreground">ข้อมูลระบุตัวตนและช่องทางติดต่อหลัก</p>
				</div>
				<button
					type="button"
					aria-label="ปิด"
					title="ปิด"
					onclick={onClose}
					class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</header>

			<div class="min-h-0 space-y-5 overflow-y-auto p-5">
				<div class="grid gap-5 md:grid-cols-[132px_1fr]">
					<div class="space-y-2">
						<span class="text-xs font-semibold text-foreground">รูปถ่าย</span>
						<input
							id="evacuee-photo"
							type="file"
							accept="image/*"
							class="sr-only"
							onchange={(event) => selectPhoto(event.currentTarget.files?.[0] ?? null)}
						/>
						<label
							for="evacuee-photo"
							class="group flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50 hover:bg-muted/60"
						>
							{#if selectedPhotoUrl || (storedPhotoUrl && !removePhoto)}
								<img
									src={selectedPhotoUrl ?? storedPhotoUrl ?? ''}
									alt="ตัวอย่างรูปผู้พักพิง"
									class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
								/>
							{:else}
								<div class="flex flex-col items-center gap-2 text-muted-foreground">
									<Camera class="size-6" />
									<span class="text-xs">เลือกรูป</span>
								</div>
							{/if}
						</label>
						{#if selectedPhotoUrl || (storedPhotoUrl && !removePhoto)}
							<button
								type="button"
								onclick={clearPhoto}
								class="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
							>
								<Trash2 class="size-3.5" /> ลบรูป
							</button>
						{/if}
					</div>

					<div class="space-y-4">
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="space-y-1.5 text-xs font-semibold text-foreground">
								ชื่อ
								<Input bind:value={firstName} autocomplete="given-name" />
							</label>
							<label class="space-y-1.5 text-xs font-semibold text-foreground">
								นามสกุล
								<Input bind:value={lastName} autocomplete="family-name" />
							</label>
						</div>
						<label class="block space-y-1.5 text-xs font-semibold text-foreground">
							ชื่อเล่น
							<Input bind:value={nickname} />
						</label>
					</div>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						ประเภทบัตรประจำตัว
						<Select.Root type="single" bind:value={cardType}>
							<Select.Trigger class="h-9 w-full">
								{cardTypeOptions.find((option) => option.value === cardType)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each cardTypeOptions as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</label>
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						เลขที่บัตรประจำตัว
						<Input bind:value={cardNumber} inputmode="numeric" />
					</label>
				</div>

				<div class="grid gap-3 sm:grid-cols-3">
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						ปีเกิด (พ.ศ.)
						<Input
							value={birthYear}
							inputmode="numeric"
							oninput={(event) => updateBirthYear(event.currentTarget.value)}
						/>
					</label>
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						อายุ
						<Input
							value={age}
							inputmode="numeric"
							oninput={(event) => updateAge(event.currentTarget.value)}
						/>
					</label>
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						เพศ
						<Select.Root type="single" bind:value={gender}>
							<Select.Trigger class="h-9 w-full">
								{genderOptions.find((option) => option.value === gender)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each genderOptions as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</label>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						สัญชาติ
						<Select.Root type="single" bind:value={country}>
							<Select.Trigger class="h-9 w-full">
								{COUNTRIES.find((option) => option.value === country)?.label ?? country}
							</Select.Trigger>
							<Select.Content class="max-h-72">
								{#each COUNTRIES as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</label>
					<label class="space-y-1.5 text-xs font-semibold text-foreground">
						ศาสนา
						<Select.Root type="single" bind:value={religion}>
							<Select.Trigger class="h-9 w-full">
								{religionOptions.find((option) => option.value === religion)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each religionOptions as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</label>
				</div>

				<div class="space-y-2">
					<label class="block space-y-1.5 text-xs font-semibold text-foreground">
						เบอร์โทรศัพท์
						<Input
							bind:value={phone}
							inputmode="numeric"
							maxlength={10}
							disabled={noPhone}
							autocomplete="tel"
						/>
					</label>
					<label class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
						<input type="checkbox" bind:checked={noPhone} class="size-4 rounded border-input" />
						ไม่มีเบอร์โทรศัพท์
					</label>
				</div>
			</div>

			<footer class="flex justify-end gap-2 border-t border-border px-5 py-4">
				<Button type="button" variant="outline" onclick={onClose}>ยกเลิก</Button>
				<Button type="button" disabled={saving} onclick={save}>
					{saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลส่วนบุคคล'}
				</Button>
			</footer>
		</div>
	</div>
{/if}
