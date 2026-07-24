<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { useCreateEvacuee, useEvacuees, useUpdateEvacuee } from '../application/queries';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		SPECIAL_NEED_CHIPS,
		maskNationalId,
		type Evacuee,
		type Household,
		evacueeInputSchema,
		specialNeedSchema
	} from '../domain/people';
	import { toast } from 'svelte-sonner';
	import Camera from '@lucide/svelte/icons/camera';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import SearchSelect from '$lib/components/search-select.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

	import Plus from '@lucide/svelte/icons/plus';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { COUNTRIES } from '$lib/utils/country';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';

	let {
		createdHousehold,
		createdHead
	}: {
		createdHousehold: Household;
		createdHead: Evacuee | null;
	} = $props();

	// --- Queries and Mutations ---
	const createEvacueeMutation = useCreateEvacuee();
	const updateEvacueeMutation = useUpdateEvacuee();
	const allEvacueesQuery = useEvacuees();

	let isSubmitting = $state(false);
	let showQrModal = $state(false);

	const cardTypeOptions = [
		{ value: 'national_id', label: 'เลขประจำตัวประชาชน (Thai National ID)' },
		{ value: 'passport', label: 'หนังสือเดินทาง (Passport)' },
		{ value: 'pink_card', label: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (Pink Card)' },
		{ value: 'other', label: 'อื่นๆ (Other)' }
	];

	const genderOptions = [
		{ value: 'male', label: 'ชาย (Male)' },
		{ value: 'female', label: 'หญิง (Female)' },
		{ value: 'other', label: 'อื่นๆ (Other)' }
	];

	const religionOptions = [
		{ value: 'buddhist', label: 'พุทธ (Buddhism)' },
		{ value: 'muslim', label: 'อิสลาม (Islam)' },
		{ value: 'christian', label: 'คริสต์ (Christianity)' },
		{ value: 'other', label: 'อื่นๆ (Other)' },
		{ value: 'unknown', label: 'ไม่ระบุ (Unknown)' }
	];

	// --- Form State (Subsequent Members) ---
	let showAddMemberForm = $state(false);
	let memberNoPhone = $state(false);
	let memberFacePhotoUrl = $state<string | null>(null);

	let memberBirthYearBE = $state('');
	let memberAge = $state('');
	let memberMedicalConditionsStr = $state('');
	let memberMedicalMedicationsStr = $state('');
	let memberMedicalAllergiesStr = $state('');

	const memberForm = superForm(defaults(zod4(evacueeInputSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(evacueeInputSchema),
		resetForm: false,
		onSubmit: ({ cancel }) => {
			if (memberNoPhone) {
				$memberFormData.phone = null;
			} else {
				const cleanPhone = ($memberFormData.phone ?? '').replace(/\D/g, '');
				if (cleanPhone.length !== 10) {
					$memberErrors.phone = ['กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือก "ไม่มีเบอร์โทร"'];
					toast.error('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือก "ไม่มีเบอร์โทร"');
					cancel();
					return;
				}
			}
		},
		onUpdate: async ({ form: f }) => {
			if (!f.valid) {
				toast.error('กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน');
				return;
			}

			isSubmitting = true;

			try {
				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'staff'
				};

				f.data.household_id = createdHousehold._id;

				const memberDoc = await createEvacueeMutation.mutateAsync({
					input: f.data,
					ctx
				});

				if (createdHead?.current_stay?.zone) {
					await updateEvacueeMutation.mutateAsync({
						...memberDoc,
						current_stay: {
							...memberDoc.current_stay,
							zone: createdHead.current_stay.zone
						}
					});
				}

				toast.success(`ลงทะเบียนสมาชิก "${f.data.first_name} ${f.data.last_name}" เรียบร้อยแล้ว`);

				// Reset member form
				memberForm.reset();
				memberFacePhotoUrl = null;
				memberBirthYearBE = '';
				memberAge = '';
				memberMedicalConditionsStr = '';
				memberMedicalMedicationsStr = '';
				memberMedicalAllergiesStr = '';
				memberNoPhone = false;

				showAddMemberForm = false;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				toast.error(`เกิดข้อผิดพลาดในการลงทะเบียนสมาชิก: ${msg}`);
			} finally {
				isSubmitting = false;
			}
		}
	});

	const {
		form: memberFormData,
		errors: memberErrors,
		submitting: memberSubmitting,
		enhance: memberEnhance
	} = memberForm;

	function updateMemberBirthYear(value: string) {
		memberBirthYearBE = value;
		$memberFormData.birth_year = value && !isNaN(Number(value)) ? Number(value) : undefined;
	}

	function updateMemberAge(value: string) {
		memberAge = value;
		if (value && !isNaN(Number(value))) {
			$memberFormData.birth_year = new Date().getFullYear() + 543 - Number(value);
		} else if (!memberBirthYearBE) {
			$memberFormData.birth_year = undefined;
		}
	}

	function updateMemberMedicalField(
		field: 'medical_conditions' | 'medical_medications' | 'medical_allergies',
		value: string
	) {
		const values = value
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
		if (field === 'medical_conditions') memberMedicalConditionsStr = value;
		if (field === 'medical_medications') memberMedicalMedicationsStr = value;
		if (field === 'medical_allergies') memberMedicalAllergiesStr = value;
		$memberFormData[field] = values;
	}

	// Get household members dynamically
	const householdMembers = $derived(
		(allEvacueesQuery.data ?? []).filter((e) => e.household_id === createdHousehold?._id)
	);

	function formatAddress(h: Household) {
		const parts = [];
		if (h.address_no) parts.push(h.address_no);
		if (h.village_no) {
			const v = h.village_no.replace(/^(ม\.|หมู่\s*)/, '');
			parts.push(`ม.${v}`);
		}
		if (h.subdistrict) {
			const s = h.subdistrict.replace(/^(ต\.|ตำบล\s*)/, '');
			parts.push(`ต.${s}`);
		}
		if (h.district) {
			const d = h.district.replace(/^(อ\.|อำเภอ\s*)/, '');
			parts.push(`อ.${d}`);
		}
		if (h.province) {
			const p = h.province.replace(/^(จ\.|จังหวัด\s*)/, '');
			parts.push(`จ.${p}`);
		}
		if (h.postal_code) parts.push(h.postal_code);
		return parts.join(' ');
	}
</script>

<div class="mx-auto w-full max-w-4xl space-y-6">
	<!-- Household Info Card & Registered Members Table -->
	<div class="space-y-6">
		<!-- Household Card Details -->
		<div class="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm">
			<div class="flex items-start gap-4">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"
				>
					<CheckCircle class="size-6" />
				</div>
				<div>
					<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
						สร้างครัวเรือนล่วงหน้าสำเร็จ
					</h3>
					<p class="text-sm text-muted-foreground">
						ครัวเรือนได้รับการจัดตั้งแล้วในระบบ สถานะ:
						<span
							class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800"
						>
							ลงทะเบียนล่วงหน้า
						</span>
					</p>
				</div>
			</div>

			<div class="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm">
				<div>
					<span class="text-xs text-muted-foreground">ชื่อครัวเรือน</span>
					<p class="font-semibold text-slate-800 dark:text-slate-200">
						{createdHousehold.label}
					</p>
				</div>
				<div>
					<span class="text-xs text-muted-foreground">หัวหน้าครัวเรือน</span>
					<p class="font-semibold text-slate-800 dark:text-slate-200">
						{createdHead ? `${createdHead.first_name} ${createdHead.last_name}` : '—'}
					</p>
				</div>
				<div class="col-span-2">
					<span class="text-xs text-muted-foreground">ที่อยู่เดิม</span>
					<p class="font-medium text-slate-800 dark:text-slate-200">
						{formatAddress(createdHousehold)}
					</p>
				</div>
			</div>
		</div>

		<!-- Member List Card -->
		<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
			<div class="mb-4 flex items-center justify-between gap-4">
				<h3 class="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
					<Users class="size-5 text-primary" />
					รายชื่อสมาชิกในบ้าน ({householdMembers.length} คน)
				</h3>
				<Button
					variant="outline"
					size="sm"
					onclick={() => (showAddMemberForm = !showAddMemberForm)}
					class="h-8 gap-1.5"
				>
					<Plus class="size-4" />
					<span>ลงทะเบียนลูกบ้านเพิ่ม</span>
				</Button>
			</div>

			<div class="overflow-x-auto rounded-xl border">
				<table class="w-full border-collapse text-left text-sm">
					<thead>
						<tr class="border-b bg-muted/40">
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">ชื่อ-นามสกุล</th>
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">บทบาท</th>
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">ระบุตัวตน / โทร</th>
							<th class="p-3 font-semibold text-slate-700 dark:text-slate-300"
								>กลุ่มช่วยเหลือพิเศษ</th
							>
						</tr>
					</thead>
					<tbody>
						{#each householdMembers as m (m._id)}
							{@const isHead = m._id === createdHousehold.head_evacuee_id}
							<tr class="border-b transition-colors last:border-0 hover:bg-muted/10">
								<td class="p-3 font-bold text-slate-900 dark:text-slate-100">
									{m.first_name}
									{m.last_name}
									{#if m.nickname}
										<span class="text-xs font-normal text-muted-foreground">({m.nickname})</span>
									{/if}
								</td>
								<td class="p-3">
									{#if isHead}
										<span class="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
											หัวหน้าครอบครัว
										</span>
									{:else}
										<span
											class="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
										>
											ลูกบ้าน
										</span>
									{/if}
								</td>
								<td class="p-3 font-mono text-xs">
									<div>ID: {maskNationalId(m.person_id?.number)}</div>
									{#if m.phone}
										<div class="opacity-75">{m.phone}</div>
									{/if}
								</td>
								<td class="p-3">
									<div class="flex flex-wrap gap-1">
										{#if m.special_needs?.length > 0}
											{#each m.special_needs as need (need)}
												<span
													class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
												>
													{SPECIAL_NEED_CHIPS[need]?.emoji}
													{SPECIAL_NEED_CHIPS[need]?.label}
												</span>
											{/each}
										{:else}
											<span class="text-xs text-muted-foreground italic">ไม่มี</span>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>
</div>

<!-- ────────────────── MODAL/INLINE FORM: Add Member Form ────────────────── -->
{#if showAddMemberForm}
	<form
		method="POST"
		use:memberEnhance
		class="mt-8 animate-in rounded-3xl border border-border bg-card p-6 shadow-md duration-200 slide-in-from-top-3"
	>
		<Field.FieldGroup>
			<div
				class="mb-6 flex flex-col gap-4 border-b pb-3 sm:flex-row sm:items-center sm:justify-between"
			>
				<h3 class="flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-200">
					<User class="size-5 text-primary" />
					ลงทะเบียนสมาชิกคนใหม่ในครอบครัว
				</h3>
				<div class="flex items-center gap-3">
					<button
						type="button"
						class="text-sm font-medium text-muted-foreground hover:text-foreground"
						onclick={() => {
							memberForm.reset();
							showAddMemberForm = false;
						}}
					>
						✖ ปิด
					</button>
				</div>
			</div>

			<div class="grid grid-cols-1 items-start gap-6 md:grid-cols-[200px_1fr]">
				<!-- Column 1: Face Photo mockup -->
				<div class="space-y-2">
					<p class="text-sm leading-none font-medium text-foreground">
						ภาพถ่ายใบหน้า (Face Recognition)
					</p>
					<input
						type="file"
						accept="image/*"
						class="hidden"
						id="member-face-photo-input"
						onchange={(e) => {
							const file = e.currentTarget.files?.[0];
							if (file) {
								memberFacePhotoUrl = URL.createObjectURL(file);
							}
						}}
					/>
					<label
						for="member-face-photo-input"
						class="block cursor-pointer rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center transition-all hover:border-primary/50 hover:bg-muted/30"
					>
						{#if memberFacePhotoUrl}
							<img
								src={memberFacePhotoUrl}
								alt="Face"
								class="h-40 w-full rounded-lg object-cover"
							/>
						{:else}
							<div class="flex h-40 flex-col items-center justify-center">
								<Camera class="mb-2 h-10 w-10 text-muted-foreground" />
								<span class="text-xs text-muted-foreground">แตะเพื่อถ่ายภาพ</span>
							</div>
						{/if}
					</label>
				</div>

				<!-- Column 2: Fields grid -->
				<div class="space-y-4">
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<Label>ประเภทบัตร</Label>
							<Select.Root type="single" bind:value={$memberFormData.person_id.cardType}
								><Select.Trigger class="h-9 w-full"
									>{cardTypeOptions.find((o) => o.value === $memberFormData.person_id.cardType)
										?.label ?? '— เลือก —'}</Select.Trigger
								><Select.Content
									>{#each cardTypeOptions as opt (opt.value)}<Select.Item
											value={opt.value}
											label={opt.label}
										/>{/each}</Select.Content
								></Select.Root
							>
						</div>
						<Form.Field form={memberForm} name="person_id.number">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>
										{#if $memberFormData.person_id.cardType === 'national_id'}
											เลขประจำตัวประชาชน
										{:else if $memberFormData.person_id.cardType === 'passport'}
											เลขที่พาสปอร์ต
										{:else if $memberFormData.person_id.cardType === 'pink_card'}
											เลขประจำตัวคนซึ่งไม่มีสัญชาติไทย
										{:else}
											เลขหมายบัตร
										{/if}
									</Form.Label>
									<Input
										{...props}
										maxlength={$memberFormData.person_id.cardType === 'national_id'
											? 13
											: $memberFormData.person_id.cardType === 'passport'
												? 9
												: undefined}
										placeholder={$memberFormData.person_id.cardType === 'national_id'
											? 'X-XXXX-XXXXX-XX-X'
											: $memberFormData.person_id.cardType === 'passport'
												? 'Passport Number'
												: 'หมายเลขบัตร'}
										bind:value={$memberFormData.person_id.number}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field form={memberForm} name="first_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อ (First Name) <span class="text-destructive">*</span></Form.Label>
									<Input
										{...props}
										placeholder="ชื่อจริง"
										bind:value={$memberFormData.first_name}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
						<Form.Field form={memberForm} name="last_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label
										>นามสกุล (Last Name) <span class="text-destructive">*</span></Form.Label
									>
									<Input {...props} placeholder="นามสกุล" bind:value={$memberFormData.last_name} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Form.Field form={memberForm} name="nickname">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อเล่น</Form.Label>
									<Input
										{...props}
										placeholder="ชื่อเล่น (ถ้ามี)"
										bind:value={$memberFormData.nickname}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
						<div class="space-y-2">
							<Label>ปีเกิด (พ.ศ.)</Label>
							<Input
								placeholder="เช่น 2530"
								value={memberBirthYearBE}
								oninput={(event) => updateMemberBirthYear(event.currentTarget.value)}
							/>
						</div>
						<div class="space-y-2">
							<Label>อายุ (ปี)</Label>
							<Input
								placeholder="อายุ"
								value={memberAge}
								inputmode="numeric"
								maxlength={3}
								oninput={(e) => {
									const val = e.currentTarget.value.replace(/\D/g, '');
									e.currentTarget.value = val;
									updateMemberAge(val);
								}}
							/>
						</div>
						<Form.Field form={memberForm} name="gender">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>เพศ <span class="text-destructive">*</span></Form.Label>
									<Select.Root type="single" bind:value={$memberFormData.gender}
										><Select.Trigger {...props} class="h-9 w-full"
											>{genderOptions.find((o) => o.value === $memberFormData.gender)?.label ??
												'— เลือก —'}</Select.Trigger
										><Select.Content
											>{#each genderOptions as opt (opt.value)}<Select.Item
													value={opt.value}
													label={opt.label}
												/>{/each}</Select.Content
										></Select.Root
									>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
						<Form.Field form={memberForm} name="phone">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label
										>เบอร์โทรศัพท์ยืนยันตัวตน <span class="text-destructive">*</span></Form.Label
									>
									<Input
										{...props}
										inputmode="numeric"
										maxlength={10}
										placeholder="08X-XXX-XXXX"
										disabled={memberNoPhone}
										value={memberNoPhone ? '' : ($memberFormData.phone ?? '')}
										oninput={(e) => {
											const val = e.currentTarget.value.replace(/\D/g, '');
											e.currentTarget.value = val;
											$memberFormData.phone = val === '' ? null : val;
										}}
									/>
									<label class="mt-1.5 flex cursor-pointer items-center gap-2 text-xs">
										<Checkbox
											checked={memberNoPhone}
											onCheckedChange={(v) => {
												memberNoPhone = !!v;
												if (memberNoPhone) {
													$memberFormData.phone = null;
													$memberErrors.phone = undefined;
												}
											}}
										/>
										<span class="text-muted-foreground">ไม่มีเบอร์โทร</span>
									</label>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<Form.Field form={memberForm} name="country">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ประเทศ <span class="text-destructive">*</span></Form.Label>
									<SearchSelect
										name={props.name}
										options={COUNTRIES}
										bind:value={$memberFormData.country}
										placeholder="ค้นหาประเทศ..."
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
						<Form.Field form={memberForm} name="religion">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ศาสนา</Form.Label>
									<Select.Root type="single" bind:value={$memberFormData.religion}
										><Select.Trigger {...props} class="h-9 w-full"
											>{religionOptions.find((o) => o.value === $memberFormData.religion)?.label ??
												'— เลือก —'}</Select.Trigger
										><Select.Content
											>{#each religionOptions as opt (opt.value)}<Select.Item
													value={opt.value}
													label={opt.label}
												/>{/each}</Select.Content
										></Select.Root
									>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<!-- Special Needs Chips -->
					<div class="space-y-2 border-t pt-4">
						<Label class="text-sm font-semibold">แท็กกลุ่มเปราะบางและความต้องการพิเศษ</Label>
						<div class="flex flex-wrap gap-2 pt-1">
							{#each specialNeedSchema.options as need (need)}
								{@const chip = SPECIAL_NEED_CHIPS[need]}
								{@const checked = ($memberFormData.special_needs ?? []).includes(need)}
								<Button
									type="button"
									variant="outline"
									onclick={() => {
										const current = $memberFormData.special_needs ?? [];
										$memberFormData.special_needs = checked
											? current.filter((n) => n !== need)
											: [...current, need];
									}}
									class="inline-flex h-auto items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-normal transition-colors
									{checked
										? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
										: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
								>
									<span>{chip.emoji}</span>
									<span>{chip.label}</span>
								</Button>
							{/each}
						</div>
					</div>

					<!-- Health & Medical Details -->
					<div class="space-y-3 border-t pt-4">
						<Label class="text-sm font-semibold">🏥 โรคประจำตัว & ข้อมูลสุขภาพ</Label>
						<div class="space-y-2">
							<Label class="text-xs text-muted-foreground">โรคประจำตัว</Label>
							<Input
								placeholder="เช่น เบาหวาน, ความดัน (ถ้าไม่มีให้เว้นว่าง)"
								value={memberMedicalConditionsStr}
								oninput={(event) =>
									updateMemberMedicalField('medical_conditions', event.currentTarget.value)}
							/>
						</div>
						<div class="space-y-2">
							<Label class="text-xs text-muted-foreground">ยาที่ใช้ประจำ</Label>
							<Input
								placeholder="เช่น ยาลดความดัน, ยาเบาหวาน (ถ้าไม่มีให้เว้นว่าง)"
								value={memberMedicalMedicationsStr}
								oninput={(event) =>
									updateMemberMedicalField('medical_medications', event.currentTarget.value)}
							/>
						</div>
						<div class="space-y-2">
							<Label class="text-xs text-muted-foreground">ประวัติการแพ้ (ยา/อาหาร)</Label>
							<Input
								placeholder="เช่น แพ้เพนิซิลลิน, อาหารทะเล, ถั่ว (ถ้าไม่มีให้เว้นว่าง)"
								value={memberMedicalAllergiesStr}
								oninput={(event) =>
									updateMemberMedicalField('medical_allergies', event.currentTarget.value)}
							/>
						</div>
						<Form.Field form={memberForm} name="medical_note">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label class="text-xs text-muted-foreground"
										>ความต้องการพิเศษ (ถ้ามี)</Form.Label
									>
									<textarea
										{...props}
										bind:value={$memberFormData.medical_note}
										placeholder="เช่น ผู้ป่วยที่ต้องรับยาเฉพาะทาง หรือต้องการการดูแลพิเศษ"
										class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
									></textarea>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3 border-t pt-4">
				<Button
					type="button"
					variant="outline"
					onclick={() => {
						memberForm.reset();
						showAddMemberForm = false;
					}}
				>
					ยกเลิก
				</Button>
				<Form.Button
					disabled={$memberSubmitting || isSubmitting}
					class="bg-primary font-semibold text-primary-foreground hover:bg-primary/90"
				>
					{$memberSubmitting || isSubmitting ? 'กำลังบันทึก...' : 'เพิ่มสมาชิกเข้าร่วมครัวเรือน'}
				</Form.Button>
			</div>
		</Field.FieldGroup>
	</form>
{/if}

<!-- Action Row Step 4 -->
<div class="mt-8 flex items-center justify-between border-t border-border pt-4">
	<p class="text-xs text-muted-foreground">
		💡 บันทึกสมาชิกสำเร็จแล้ว สมาชิกทุกคนจะผูกอยู่กับครัวเรือนนี้
	</p>
	<div class="flex items-center gap-2">
		{#if createdHead}
			<Button
				variant="outline"
				class="h-11 px-6 font-semibold"
				onclick={() => (showQrModal = true)}
			>
				ออกและพิมพ์ QR ประจำตัว
			</Button>
		{/if}
		<Button
			onclick={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
			class="h-11 bg-emerald-600 px-8 font-semibold text-white hover:bg-emerald-700"
		>
			เสร็จสิ้นการลงทะเบียนล่วงหน้า ✔
		</Button>
	</div>
</div>

{#if showQrModal && createdHead}
	<EvacueeQrModal show={showQrModal} evacuee={createdHead} onClose={() => (showQrModal = false)} />
{/if}
