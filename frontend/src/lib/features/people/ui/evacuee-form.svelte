<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		evacueeInputSchema,
		genderSchema,
		religionSchema,
		specialNeedSchema,
		SPECIAL_NEED_CHIPS,
		EWAR_SYMPTOM_GROUPS,
		type EvacueeInput
	} from '../domain/people';
	import { SvelteSet } from 'svelte/reactivity';
	import Camera from '@lucide/svelte/icons/camera';

	let {
		onsubmit,
		pending = false,
		step = $bindable(1)
	}: { onsubmit: (input: EvacueeInput, symptoms: string[]) => void; pending?: boolean; step?: 1 | 2 } = $props();

	// "ไม่มี" — when checked, the evacuee has no phone (schema nullable → null).
	// ── Step state ──────────────────────────────────────────────────────────────

	let selectedSymptoms = $state(new SvelteSet<string>());
	let isHealthy = $state(false);

	function toggleSymptom(id: string) {
		if (isHealthy) return;
		if (selectedSymptoms.has(id)) {
			selectedSymptoms.delete(id);
		} else {
			selectedSymptoms.add(id);
		}
	}

	function toggleHealthy() {
		isHealthy = !isHealthy;
		if (isHealthy) selectedSymptoms.clear();
	}

	function goNext() {
		step = 2;
	}

	// ── Registration form state (Step 2) ────────────────────────────────────────
	let noPhone = $state(false);
	let birthDateStr = $state('');
	let facePhotoUrl = $state<string | null>(null);
	let medicalConditionsStr = $state('');
	let medicalMedicationsStr = $state('');
	let medicalAllergiesStr = $state('');

	const form = superForm(defaults(zod4(evacueeInputSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(evacueeInputSchema),
		resetForm: false,
		onSubmit: ({ cancel }) => {
			if ($formData.person_id.cardType === 'national_id' && $formData.person_id.number) {
				const cleanId = $formData.person_id.number.replace(/\D/g, '');
				if (cleanId.length !== 13) {
					// @ts-ignore - manual error setting for nested object
					$errors.person_id = { number: ['เลขประจำตัวประชาชนต้องมี 13 หลัก'] };
					cancel();
					return;
				}
			}
		},
		onUpdate: async ({ form }) => {
			if (!form.valid) return;
			onsubmit(form.data, Array.from(selectedSymptoms));
			noPhone = false;
			selectedSymptoms.clear();
			isHealthy = false;
			step = 1;
			birthDateStr = '';
			facePhotoUrl = null;
			medicalConditionsStr = '';
			medicalMedicationsStr = '';
			medicalAllergiesStr = '';
			reset();
		}
	});

	const { form: formData, errors, submitting, reset } = form;

	// Toggling "no phone" clears the field to null so the nullable phone passes.
	$effect(() => {
		if (noPhone) $formData.phone = null;
	});



	let age = $derived.by(() => {
		if (!birthDateStr) return '';
		const birthDate = new Date(birthDateStr);
		const today = new Date();
		let calcAge = today.getFullYear() - birthDate.getFullYear();
		const m = today.getMonth() - birthDate.getMonth();
		if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
			calcAge--;
		}
		return calcAge >= 0 ? calcAge : '';
	});

	$effect(() => {
		if (birthDateStr) {
			const birthDate = new Date(birthDateStr);
			$formData.birth_year = birthDate.getFullYear() + 543;
		} else {
			$formData.birth_year = undefined;
		}
	});

	$effect(() => {
		$formData.medical_conditions = medicalConditionsStr
			? medicalConditionsStr.split(',').map((s) => s.trim()).filter(Boolean)
			: [];
	});

	$effect(() => {
		$formData.medical_medications = medicalMedicationsStr
			? medicalMedicationsStr.split(',').map((s) => s.trim()).filter(Boolean)
			: [];
	});

	$effect(() => {
		$formData.medical_allergies = medicalAllergiesStr
			? medicalAllergiesStr.split(',').map((s) => s.trim()).filter(Boolean)
			: [];
	});
</script>


<!-- ── Step indicator ─────────────────────────────────────────────────────────── -->
<div class="mb-6 flex items-center gap-3">
	{#each [1, 2] as s (s)}
		<div class="flex items-center gap-2">
			<div
				class="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
				s
					? 'bg-primary text-primary-foreground'
					: step > s
						? 'bg-green-600 text-white'
						: 'bg-muted text-muted-foreground'}"
			>
				{step > s ? '✓' : s}
			</div>
			<span class="text-sm font-medium {step === s ? 'text-foreground' : 'text-muted-foreground'}">
				{s === 1 ? 'ประเมินอาการ (EWAR)' : 'ข้อมูลผู้ประสบภัย'}
			</span>
		</div>
		{#if s < 2}
			<div class="h-px flex-1 bg-border"></div>
		{/if}
	{/each}
</div>

<!-- STEP 1 — EWAR Symptoms -->
{#if step === 1}
	<div class="space-y-4">
		<!-- Section header -->
		

		<!-- Healthy toggle -->
		<Button
			type="button"
			variant="outline"
			onclick={toggleHealthy}
			class="w-full h-auto rounded-xl border-2 p-4 text-center font-semibold transition-colors {isHealthy
				? 'border-green-500 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800 dark:bg-green-950/30 dark:text-green-400 dark:hover:bg-green-950/50'
				: 'border-border bg-muted/30 text-muted-foreground hover:border-green-400 hover:bg-green-50/50'}"
		>
			{isHealthy ? '✅' : '🟩'} ไม่มีอาการป่วย (Healthy / No Symptoms)
		</Button>

		<!-- Symptom groups -->
		{#each EWAR_SYMPTOM_GROUPS as group (group.title)}
			<div class="space-y-2">
				<p class="text-sm font-semibold text-foreground">{group.title}</p>
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{#each group.symptoms as symptom (symptom.id)}
						<Button
							type="button"
							variant="outline"
							disabled={isHealthy}
							onclick={() => toggleSymptom(symptom.id)}
							class="h-auto flex items-start gap-2 rounded-lg border p-3 text-left text-sm font-normal transition-colors disabled:pointer-events-none disabled:opacity-40 {selectedSymptoms.has(
								symptom.id
							)
								? 'border-primary bg-primary/10 text-foreground hover:bg-primary/15'
								: 'border-border bg-card text-foreground hover:border-primary/50 hover:bg-primary/5'}"
						>
							<span class="text-lg leading-none">{symptom.emoji}</span>
							<span class="leading-snug whitespace-normal">
								{symptom.label}
								{#if symptom.sublabel}
									<span class="block text-xs text-muted-foreground">{symptom.sublabel}</span>
								{/if}
							</span>
						</Button>
					{/each}
				</div>
			</div>
		{/each}

		<!-- Next button -->
		<div class="flex justify-end pt-2">
			<Button
				type="button"
				onclick={goNext}
				class="px-6 py-2.5 text-sm font-semibold"
			>
				ถัดไป →
			</Button>
		</div>
	</div>
{/if}

<!-- STEP 2 — Registration form -->
{#if step === 2}
	<form method="POST" use:form.enhance class="space-y-6">
		<Field.FieldGroup>
			<div class="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
				<!-- Column 1: Face Photo mockup -->
				<div class="space-y-2">
					<p class="text-sm font-medium leading-none text-foreground">ภาพถ่ายใบหน้า (Face Recognition)</p>
					<input
						type="file"
						accept="image/*"
						class="hidden"
						id="face-photo-input"
						onchange={(e) => {
							const file = e.currentTarget.files?.[0];
							if (file) {
								facePhotoUrl = URL.createObjectURL(file);
							}
						}}
					/>
					<label
						for="face-photo-input"
						class="cursor-pointer block border border-dashed border-muted-foreground/30 hover:border-primary/50 bg-muted/20 hover:bg-muted/30 transition-all rounded-xl p-4 text-center"
					>
						{#if facePhotoUrl}
							<img src={facePhotoUrl} alt="Face" class="w-full h-40 object-cover rounded-lg" />
						{:else}
							<div class="flex flex-col items-center justify-center h-40">
								<Camera class="h-10 w-10 text-muted-foreground mb-2" />
								<span class="text-xs text-muted-foreground">แตะเพื่อถ่ายภาพ</span>
							</div>
						{/if}
					</label>
				</div>

				<!-- Column 2: Fields grid -->
				<div class="space-y-4">
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<!-- ประเภทบัตร -->
						<div class="space-y-2">
							<Label>ประเภทบัตร</Label>
							<select
								bind:value={$formData.person_id.cardType}
								class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<option value="national_id">เลขประจำตัวประชาชน (Thai National ID)</option>
								<option value="passport">หนังสือเดินทาง (Passport)</option>
								<option value="pink_card">บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (Pink Card)</option>
								<option value="other">อื่นๆ (Other)</option>
							</select>
						</div>

						<!-- เลขประจำตัวประชาชน / พาสปอร์ต / อื่นๆ -->
						<Form.Field {form} name="person_id.number">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>
										{#if $formData.person_id.cardType === 'national_id'}
											เลขประจำตัวประชาชน
										{:else if $formData.person_id.cardType === 'passport'}
											เลขที่พาสปอร์ต
										{:else if $formData.person_id.cardType === 'pink_card'}
											เลขประจำตัวคนซึ่งไม่มีสัญชาติไทย
										{:else}
											เลขหมายบัตร
										{/if}
									</Form.Label>
									<Input
										{...props}
										maxlength={$formData.person_id.cardType === 'national_id' ? 13 : ($formData.person_id.cardType === 'passport' ? 9 : undefined)}
										placeholder={$formData.person_id.cardType === 'national_id' ? 'X-XXXX-XXXXX-XX-X' : ($formData.person_id.cardType === 'passport' ? 'Passport Number' : 'หมายเลขบัตร')}
										bind:value={$formData.person_id.number}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<!-- ชื่อ -->
						<Form.Field {form} name="first_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อ (First Name)</Form.Label>
									<Input {...props} placeholder="ชื่อจริง" bind:value={$formData.first_name} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>

						<!-- นามสกุล -->
						<Form.Field {form} name="last_name">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>นามสกุล (Last Name)</Form.Label>
									<Input {...props} placeholder="นามสกุล" bind:value={$formData.last_name} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>

						<!-- ชื่อเล่น -->
						<Form.Field {form} name="nickname">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ชื่อเล่น</Form.Label>
									<Input {...props} placeholder="ชื่อเล่น (ถ้ามี)" bind:value={$formData.nickname} />
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
						<!-- วันเกิด -->
						<div class="space-y-2">
							<Label>วันเกิด</Label>
							<Input
								type="date"
								bind:value={birthDateStr}
							/>
						</div>

						<!-- อายุ -->
						<div class="space-y-2">
							<Label>อายุ (ปี)</Label>
							<Input
								type="text"
								disabled
								value={age}
								class="bg-muted text-muted-foreground"
							/>
						</div>

						<!-- เพศ -->
						<Form.Field {form} name="gender">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>เพศ</Form.Label>
									<select
										{...props}
										bind:value={$formData.gender}
										class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									>
										{#each genderSchema.options as g (g)}
											<option value={g}>
												{g === 'male' ? 'ชาย (Male)' : g === 'female' ? 'หญิง (Female)' : 'อื่นๆ (Other)'}
											</option>
										{/each}
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>

						<!-- เบอร์โทรศัพท์ -->
						<Form.Field {form} name="phone">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>เบอร์โทรศัพท์ยืนยันตัวตน</Form.Label>
									<Input
										{...props}
										inputmode="numeric"
										placeholder="08X-XXX-XXXX"
										disabled={noPhone}
										value={$formData.phone ?? ''}
										oninput={(e) => ($formData.phone = e.currentTarget.value)}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>

					<!-- Checkbox ไม่มีเบอร์โทรศัพท์ -->
					<div class="flex items-center space-x-2">
						<Checkbox id="no-phone" bind:checked={noPhone} />
						<Label for="no-phone" class="text-sm font-medium leading-none cursor-pointer">ไม่มี (no phone)</Label>
					</div>

					<div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
						<!-- ประเทศ -->
						<Form.Field {form} name="country">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ประเทศ</Form.Label>
									<select
										{...props}
										bind:value={$formData.country}
										class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									>
										<option value="ไทย">ไทย</option>
										<option value="เมียนมา">เมียนมา</option>
										<option value="กัมพูชา">กัมพูชา</option>
										<option value="ลาว">ลาว</option>
										<option value="อื่นๆ">อื่นๆ</option>
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>


						<!-- ศาสนา -->
						<Form.Field {form} name="religion">
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>ศาสนา *</Form.Label>
									<select
										{...props}
										bind:value={$formData.religion}
										class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
									>
										{#each religionSchema.options as r (r)}
											<option value={r}>
												{r === 'buddhist'
													? 'พุทธ (Buddhism)'
													: r === 'muslim'
														? 'อิสลาม (Islam)'
														: r === 'christian'
															? 'คริสต์ (Christianity)'
															: r === 'other'
																? 'อื่นๆ (Other)'
																: 'ไม่ระบุ (Unknown)'}
											</option>
										{/each}
									</select>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</div>
				</div>
			</div>

			<!-- Medical fields section (โรคประจำตัว) -->
			<div class="border-t border-border pt-6 space-y-4 w-full">
				<h3 class="text-sm font-semibold text-foreground flex items-center gap-2">
					<span>🏥</span> โรคประจำตัว & ข้อมูลสุขภาพ
				</h3>
				<div class="grid grid-cols-1 gap-4">
					<div class="space-y-2">
						<Label>โรคประจำตัว</Label>
						<Input placeholder="เช่น เบาหวาน, ความดัน (ถ้าไม่มีให้เว้นว่าง)" bind:value={medicalConditionsStr} />
					</div>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label>ประวัติการแพ้ยา</Label>
						<Input placeholder="เช่น พาราเซตามอล (ถ้าไม่มีให้เว้นว่าง)" bind:value={medicalMedicationsStr} />
					</div>

					<div class="space-y-2">
						<Label>ประวัติการแพ้อาหาร</Label>
						<Input placeholder="เช่น อาหารทะเล, ถั่ว (ถ้าไม่มีให้เว้นว่าง)" bind:value={medicalAllergiesStr} />
					</div>
				</div>
			</div>

			<!-- Special Needs section -->
			<div class="border-t border-border pt-6 space-y-2 w-full">
				<Label class="text-sm font-semibold">แท็กกลุ่มเปราะบางและความต้องการพิเศษ</Label>
				<div class="flex flex-wrap gap-2 pt-1">
					{#each specialNeedSchema.options as need (need)}
						{@const chip = SPECIAL_NEED_CHIPS[need]}
						{@const checked = ($formData.special_needs ?? []).includes(need)}
						<Button
							type="button"
							variant="outline"
							onclick={() => {
								const current = $formData.special_needs ?? [];
								$formData.special_needs = checked
									? current.filter((n) => n !== need)
									: [...current, need];
							}}
							class="h-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-normal transition-colors {checked
								? 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/15'
								: 'border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-primary/5'}"
						>
							<span>{chip.emoji}</span>
							<span>{chip.label}</span>
						</Button>
					{/each}
				</div>
				<Form.Field {form} name="special_needs"><Form.FieldErrors /></Form.Field>

				<div class="pt-2">
					<Form.Field {form} name="medical_note">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ความต้องการพิเศษ (ถ้ามี)</Form.Label>
								<textarea
									{...props}
									bind:value={$formData.medical_note}
									placeholder="เช่น ผู้ป่วยที่ต้องรับยาเฉพาะทาง หรือต้องการการดูแลพิเศษ"
									class="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								></textarea>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>

			<!-- Back + Submit row -->
			<div class="flex items-center gap-3 pt-6 border-t border-border w-full">
				<Button
					type="button"
					variant="outline"
					onclick={() => (step = 1)}
					class="gap-1 px-6 py-2 text-sm font-medium h-10"
				>
					ย้อนกลับ
				</Button>
				<Form.Button class="flex-1 h-10" disabled={$submitting || pending}> ลงทะเบียนผู้ประสบภัย ⏭️</Form.Button>
			</div>
		</Field.FieldGroup>
	</form>
{/if}
