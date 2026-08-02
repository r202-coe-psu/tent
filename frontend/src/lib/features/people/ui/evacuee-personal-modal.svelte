<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Camera from '@lucide/svelte/icons/camera';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		evacueePersonalEditFormSchema,
		type CardType,
		type Evacuee,
		type Gender,
		type Religion
	} from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { imageRepository } from '$lib/features/images';
	import { COUNTRIES } from '$lib/utils/country';
	import SearchSelect from '$lib/components/search-select.svelte';

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
	let lastOpenedEvacueeId = $state<string | null>(null);

	const form = superForm(defaults(initial, zod4(evacueePersonalEditFormSchema)), {
		SPA: true,
		validators: zod4(evacueePersonalEditFormSchema),
		resetForm: false
	});
	const { form: formData, validateForm } = form;

	// Rehydrate from the latest query result each time this modal opens. The
	// component stays mounted between opens, so one-time initial state can be stale.
	$effect(() => {
		if (!show) {
			lastOpenedEvacueeId = null;
			return;
		}
		if (lastOpenedEvacueeId === evacuee._id) return;

		const next = {
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
		};
		firstName = next.firstName;
		lastName = next.lastName;
		nickname = next.nickname;
		birthYear = next.birthYear;
		age = next.age;
		gender = next.gender;
		phone = next.phone;
		noPhone = next.noPhone;
		cardType = next.cardType;
		cardNumber = next.cardNumber;
		country = next.country;
		religion = next.religion;
		$formData = next;
		photoFile = null;
		removePhoto = false;
		storedPhotoUrl = null;
		lastOpenedEvacueeId = evacuee._id;
	});

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
		$formData = {
			firstName,
			lastName,
			nickname,
			birthYear,
			age,
			gender,
			phone,
			noPhone,
			cardType,
			cardNumber,
			country,
			religion
		};
		const validation = await validateForm({ update: true, focusOnError: true });
		if (!validation.valid) {
			toast.error('กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน');
			return;
		}

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

		const parsedAge = age.trim() !== '' ? Number.parseInt(age, 10) : undefined;
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
				firstName: validation.data.firstName,
				lastName: validation.data.lastName,
				nickname: validation.data.nickname,
				birthYear: parsedBirthYear,
				age: parsedAge,
				gender: validation.data.gender,
				phone: validation.data.noPhone ? null : digits(validation.data.phone),
				cardType: validation.data.cardType,
				cardNumber:
					validation.data.cardType === 'national_id'
						? digits(validation.data.cardNumber)
						: validation.data.cardNumber,
				country: validation.data.country,
				religion: validation.data.religion,
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
						<span class="text-xs font-medium text-foreground">รูปถ่าย</span>
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
							<Form.Field {form} name="firstName">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ชื่อ <span class="text-destructive">*</span></Form.Label>
										<Input {...props} bind:value={firstName} autocomplete="given-name" />
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
							<Form.Field {form} name="lastName">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>นามสกุล <span class="text-destructive">*</span></Form.Label>
										<Input {...props} bind:value={lastName} autocomplete="family-name" />
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>
						<Form.Field {form} name="nickname">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อเล่น</Form.Label>
									<Input {...props} bind:value={nickname} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<Form.Field {form} name="cardType">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ประเภทบัตรประจำตัว</Form.Label>
								<Select.Root type="single" bind:value={cardType}>
									<Select.Trigger {...props} class="!h-9 w-full rounded-md">
										{cardTypeOptions.find((option) => option.value === cardType)?.label}
									</Select.Trigger>
									<Select.Content>
										{#each cardTypeOptions as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="cardNumber">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เลขที่บัตรประจำตัว</Form.Label>
								<Input {...props} bind:value={cardNumber} inputmode="numeric" />
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid gap-3 sm:grid-cols-3">
					<Form.Field {form} name="birthYear">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ปีเกิด (พ.ศ.)</Form.Label>
								<Input
									{...props}
									value={birthYear}
									inputmode="numeric"
									oninput={(event) => updateBirthYear(event.currentTarget.value)}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="age">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>อายุ</Form.Label>
								<Input
									{...props}
									value={age}
									inputmode="numeric"
									oninput={(event) => updateAge(event.currentTarget.value)}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="gender">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เพศ <span class="text-destructive">*</span></Form.Label>
								<Select.Root type="single" bind:value={gender}>
									<Select.Trigger {...props} class="!h-9 w-full rounded-md">
										{genderOptions.find((option) => option.value === gender)?.label}
									</Select.Trigger>
									<Select.Content>
										{#each genderOptions as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
					<Form.Field {form} name="country">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>สัญชาติ <span class="text-destructive">*</span></Form.Label>
								<SearchSelect
									name={props.name}
									options={COUNTRIES}
									bind:value={country}
									placeholder="เลือกสัญชาติ"
									searchPlaceholder="ค้นหาสัญชาติ..."
									emptyText="ไม่พบสัญชาติ"
									controlProps={{ ...props, id: 'country' }}
									class="!h-9 rounded-md"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="religion">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ศาสนา</Form.Label>
								<Select.Root type="single" bind:value={religion}>
									<Select.Trigger {...props} class="!h-9 w-full rounded-md">
										{religionOptions.find((option) => option.value === religion)?.label}
									</Select.Trigger>
									<Select.Content>
										{#each religionOptions as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div class="space-y-2">
					<Form.Field {form} name="phone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เบอร์โทรศัพท์ <span class="text-destructive">*</span></Form.Label>
								<Input
									{...props}
									bind:value={phone}
									inputmode="numeric"
									maxlength={10}
									disabled={noPhone}
									autocomplete="tel"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="noPhone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="cursor-pointer text-xs text-muted-foreground">
									<Checkbox {...props} id="no-phone" bind:checked={noPhone} />
									ไม่มีเบอร์โทรศัพท์
								</Form.Label>
							{/snippet}
						</Form.Control>
					</Form.Field>
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
