<script lang="ts">
	import { untrack } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { useMasterData } from '$lib/features/master-data';
	import {
		EWAR_SYMPTOM_GROUPS,
		evacueeHealthEditFormSchema,
		type BloodGroup,
		type CareTrack,
		type Evacuee,
		type Medical,
		type Screening
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

	export type EvacueeHealthEditData = {
		bloodGroup: BloodGroup;
		careTrack: CareTrack;
		conditions: string[];
		medications: string[];
		allergies: string[];
		medicalNotes: string;
		screeningNotes: string;
		ewarSymptoms: string[];
		temperatureC: number | null;
		referral: boolean;
		specialNeeds: string[];
	};

	let {
		show,
		evacuee,
		medical,
		screening,
		onClose,
		onSave
	}: {
		show: boolean;
		evacuee: Evacuee;
		medical: Medical | null;
		screening: Screening | null;
		onClose: () => void;
		onSave: (data: EvacueeHealthEditData) => Promise<void>;
	} = $props();

	const bloodGroupOptions: { value: BloodGroup; label: string }[] = [
		{ value: 'unknown', label: 'ไม่ระบุ' },
		{ value: 'A', label: 'A' },
		{ value: 'B', label: 'B' },
		{ value: 'AB', label: 'AB' },
		{ value: 'O', label: 'O' }
	];
	const careTrackOptions: { value: CareTrack; label: string }[] = [
		{ value: 'normal', label: 'ดูแลตามปกติ' },
		{ value: 'fast_track', label: 'Fast track' }
	];

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	let bloodGroup = $state<BloodGroup>('unknown');
	let careTrack = $state<CareTrack>('normal');
	let conditions = $state('');
	let medications = $state('');
	let allergies = $state('');
	let medicalNotes = $state('');
	let screeningNotes = $state('');
	let selectedSymptoms = $state<string[]>([]);
	let temperature = $state<number | null>(null);
	let referral = $state(false);
	let specialNeeds = $state<string[]>([]);
	let saving = $state(false);
	let validationError = $state('');
	let lastOpenedEvacueeId = $state<string | null>(null);

	const specialNeedOptions = $derived.by(() => {
		const supported = shelterQuery.data?.admission_policy?.supported_vulnerable_groups ?? [];
		const masterItems = vulnerableGroupQuery.data?.items ?? [];
		const labels = new Map(
			masterItems.filter((item) => item.status === 'active').map((item) => [item.code, item.label])
		);
		const codes = supported.filter((code) => labels.has(code));

		for (const code of specialNeeds) {
			if (!codes.includes(code)) codes.push(code);
		}

		return codes.map((code) => ({ code, label: labels.get(code) ?? code }));
	});

	const temperatureError = $derived.by(() => {
		if (temperature === null) return '';
		if (!Number.isFinite(temperature)) return 'กรุณากรอกอุณหภูมิเป็นตัวเลข';
		if (temperature < 30 || temperature > 45) return 'อุณหภูมิต้องอยู่ระหว่าง 30 ถึง 45 °C';
		return '';
	});

	function snapshot() {
		return {
			bloodGroup: medical?.blood_group ?? 'unknown',
			careTrack: medical?.track ?? screening?.track ?? 'normal',
			conditions: (medical?.conditions ?? []).join(', '),
			medications: (medical?.medications ?? []).join(', '),
			allergies: (medical?.allergies ?? []).join(', '),
			medicalNotes: medical?.notes ?? '',
			screeningNotes: screening?.notes ?? '',
			selectedSymptoms: [...(screening?.symptoms ?? [])],
			temperature: screening?.temperature_c ?? null,
			referral: screening?.needs_referral ?? false,
			specialNeeds: [...(evacuee.special_needs ?? [])]
		};
	}

	function resetForm() {
		const initial = untrack(snapshot);
		bloodGroup = initial.bloodGroup;
		careTrack = initial.careTrack;
		conditions = initial.conditions;
		medications = initial.medications;
		allergies = initial.allergies;
		medicalNotes = initial.medicalNotes;
		screeningNotes = initial.screeningNotes;
		selectedSymptoms = initial.selectedSymptoms;
		temperature = initial.temperature;
		referral = initial.referral;
		specialNeeds = initial.specialNeeds;
		validationError = '';
		saving = false;
	}

	$effect(() => {
		if (!show) {
			lastOpenedEvacueeId = null;
			return;
		}
		if (lastOpenedEvacueeId !== evacuee._id) {
			lastOpenedEvacueeId = evacuee._id;
			resetForm();
		}
	});

	function listFromText(value: string): string[] {
		return [
			...new Set(
				value
					.split(',')
					.map((item) => item.trim())
					.filter(Boolean)
			)
		];
	}

	function toggleSymptom(id: string) {
		selectedSymptoms = selectedSymptoms.includes(id)
			? selectedSymptoms.filter((symptomId) => symptomId !== id)
			: [...selectedSymptoms, id];
	}

	function toggleSpecialNeed(code: string) {
		specialNeeds = specialNeeds.includes(code)
			? specialNeeds.filter((need) => need !== code)
			: [...specialNeeds, code];
	}

	const form = superForm(defaults(snapshot(), zod4(evacueeHealthEditFormSchema)), {
		SPA: true,
		validators: zod4(evacueeHealthEditFormSchema),
		resetForm: false
	});
	const { form: formData, validateForm } = form;

	function validate(): boolean {
		if (temperatureError) {
			validationError = temperatureError;
			return false;
		}
		validationError = '';
		return true;
	}

	async function save() {
		$formData = {
			bloodGroup,
			careTrack,
			conditions,
			medications,
			allergies,
			medicalNotes,
			screeningNotes,
			selectedSymptoms,
			temperature,
			referral,
			specialNeeds
		};
		const validation = await validateForm({ update: true, focusOnError: true });
		if (saving || !validation.valid) {
			if (!validation.valid) validationError = 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน';
			return;
		}
		if (!validate()) return;

		saving = true;
		try {
			await onSave({
				bloodGroup: validation.data.bloodGroup,
				careTrack: validation.data.careTrack,
				conditions: listFromText(validation.data.conditions),
				medications: listFromText(validation.data.medications),
				allergies: listFromText(validation.data.allergies),
				medicalNotes: validation.data.medicalNotes,
				screeningNotes: validation.data.screeningNotes,
				ewarSymptoms: validation.data.selectedSymptoms,
				temperatureC: validation.data.temperature,
				referral: validation.data.referral,
				specialNeeds: validation.data.specialNeeds
			});
		} finally {
			saving = false;
		}
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		void save();
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-xs sm:p-5"
		role="presentation"
	>
		<div
			class="flex max-h-[94vh] w-full max-w-3xl animate-in flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl duration-150 zoom-in-95 fade-in"
			role="dialog"
			aria-modal="true"
			aria-labelledby="evacuee-health-modal-title"
		>
			<header
				class="flex items-start justify-between gap-4 border-b border-border bg-muted/25 px-4 py-3.5 sm:px-5"
			>
				<div class="flex min-w-0 items-center gap-3">
					<div
						class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
					>
						<Activity class="size-5" aria-hidden="true" />
					</div>
					<div class="min-w-0">
						<h2
							id="evacuee-health-modal-title"
							class="truncate text-base font-bold text-foreground"
						>
							แก้ไขข้อมูลสุขภาพ
						</h2>
						<p class="truncate text-xs text-muted-foreground">
							{evacuee.first_name}
							{evacuee.last_name}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
					aria-label="ปิดหน้าต่างแก้ไขข้อมูลสุขภาพ"
					title="ปิด"
					onclick={onClose}
					disabled={saving}
				>
					<X class="size-5" aria-hidden="true" />
				</button>
			</header>

			<form class="min-h-0 overflow-y-auto" onsubmit={handleSubmit}>
				<div class="space-y-5 p-4 sm:p-5">
					<section class="space-y-3" aria-labelledby="health-summary-heading">
						<div class="flex items-center justify-between border-b border-border pb-2">
							<h3 id="health-summary-heading" class="text-sm font-semibold text-foreground">
								สรุปการดูแล
							</h3>
							{#if referral}
								<span
									class="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
								>
									<AlertTriangle class="size-3.5" aria-hidden="true" />
									ต้องส่งต่อ
								</span>
							{/if}
						</div>

						<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<Form.Field {form} name="bloodGroup">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>หมู่เลือด</Form.Label>
										<Select.Root type="single" bind:value={bloodGroup}>
											<Select.Trigger
												{...props}
												id="health-blood-group"
												class="!h-9 w-full rounded-md bg-background"
											>
												{bloodGroupOptions.find((option) => option.value === bloodGroup)?.label ??
													'ไม่ระบุ'}
											</Select.Trigger>
											<Select.Content>
												{#each bloodGroupOptions as option (option.value)}
													<Select.Item value={option.value} label={option.label} />
												{/each}
											</Select.Content>
										</Select.Root>
									{/snippet}
								</Form.Control>
							</Form.Field>

							<Form.Field {form} name="careTrack">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>แนวทางดูแล</Form.Label>
										<Select.Root type="single" bind:value={careTrack}>
											<Select.Trigger
												{...props}
												id="health-care-track"
												class="!h-9 w-full rounded-md bg-background"
											>
												{careTrackOptions.find((option) => option.value === careTrack)?.label ??
													'ดูแลตามปกติ'}
											</Select.Trigger>
											<Select.Content>
												{#each careTrackOptions as option (option.value)}
													<Select.Item value={option.value} label={option.label} />
												{/each}
											</Select.Content>
										</Select.Root>
									{/snippet}
								</Form.Control>
							</Form.Field>

							<Form.Field {form} name="temperature">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>อุณหภูมิ (°C)</Form.Label>
										<Input
											{...props}
											id="health-temperature"
											bind:value={temperature}
											type="number"
											inputmode="decimal"
											step="0.1"
											min="30"
											max="45"
											placeholder="เช่น 36.8"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>
					</section>

					<section class="space-y-3" aria-labelledby="health-history-heading">
						<h3
							id="health-history-heading"
							class="border-b border-border pb-2 text-sm font-semibold text-foreground"
						>
							ประวัติสุขภาพ
						</h3>
						<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
							<Form.Field {form} name="conditions">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>โรคประจำตัว</Form.Label>
										<Textarea
											{...props}
											id="health-conditions"
											bind:value={conditions}
											rows={3}
											placeholder="เช่น เบาหวาน, ความดัน"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
							<Form.Field {form} name="medications">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ยาที่ใช้ประจำ</Form.Label>
										<Textarea
											{...props}
											id="health-medications"
											bind:value={medications}
											rows={3}
											placeholder="เช่น ยาลดความดัน"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
							<Form.Field {form} name="allergies">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ประวัติการแพ้</Form.Label>
										<Textarea
											{...props}
											id="health-allergies"
											bind:value={allergies}
											rows={3}
											placeholder="เช่น เพนิซิลลิน, อาหารทะเล"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>
					</section>

					<section class="space-y-3" aria-labelledby="ewar-heading">
						<div class="flex items-center justify-between border-b border-border pb-2">
							<h3 id="ewar-heading" class="text-sm font-semibold text-foreground">
								อาการเฝ้าระวัง EWAR
							</h3>
							{#if selectedSymptoms.length > 0}
								<span class="text-xs font-semibold text-red-700 dark:text-red-300"
									>เลือกแล้ว {selectedSymptoms.length} รายการ</span
								>
							{/if}
						</div>

						<Form.Field {form} name="selectedSymptoms">
							<Form.Control>
								<div class="grid grid-cols-1 gap-2 md:grid-cols-2">
									{#each EWAR_SYMPTOM_GROUPS as group (group.title)}
										<div class="overflow-hidden rounded-lg border border-border bg-background">
											<div
												class="flex items-center justify-between border-b border-border bg-muted/20 px-3 py-2"
											>
												<h4 class="text-xs font-semibold text-foreground">{group.title}</h4>
												<span class="text-[10px] text-muted-foreground">
													{group.symptoms.filter((symptom) => selectedSymptoms.includes(symptom.id))
														.length}/{group.symptoms.length}
												</span>
											</div>
											<div class="space-y-1 p-2">
												{#each group.symptoms as symptom (symptom.id)}
													{@const checked = selectedSymptoms.includes(symptom.id)}
													<button
														type="button"
														role="checkbox"
														aria-checked={checked}
														aria-label={symptom.label}
														onclick={() => toggleSymptom(symptom.id)}
														class="flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {checked
															? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/35 dark:text-red-100'
															: 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground'}"
													>
														<span
															class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border {checked
																? 'border-red-600 bg-red-600 text-white'
																: 'border-muted-foreground/50 bg-background'}"
														>
															{#if checked}<Check class="size-3" aria-hidden="true" />{/if}
														</span>
														<span class="leading-snug">{symptom.label}</span>
													</button>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>
					</section>

					<section class="space-y-3" aria-labelledby="needs-heading">
						<div class="border-b border-border pb-2">
							<h3 id="needs-heading" class="text-sm font-semibold text-foreground">
								กลุ่มเปราะบางและการส่งต่อ
							</h3>
							<p class="text-[11px] text-muted-foreground">แสดงเฉพาะกลุ่มที่ศูนย์พักพิงรองรับ</p>
						</div>

						<Form.Field {form} name="specialNeeds">
							<Form.Control>
								<div class="space-y-2">
									<Form.Label>กลุ่มเปราะบาง</Form.Label>
									{#if vulnerableGroupQuery.isLoading || shelterQuery.isLoading}
										<p class="text-xs text-muted-foreground">กำลังโหลดรายการกลุ่มเปราะบาง...</p>
									{:else if specialNeedOptions.length === 0}
										<p
											class="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
										>
											ศูนย์พักพิงยังไม่ได้กำหนดกลุ่มเปราะบางที่รองรับ
										</p>
									{:else}
										<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
											{#each specialNeedOptions as option (option.code)}
												{@const checked = specialNeeds.includes(option.code)}
												<button
													type="button"
													role="checkbox"
													aria-checked={checked}
													onclick={() => toggleSpecialNeed(option.code)}
													class="flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {checked
														? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100'
														: 'border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
												>
													<span
														class="flex size-4 shrink-0 items-center justify-center rounded border {checked
															? 'border-amber-600 bg-amber-600 text-white'
															: 'border-muted-foreground/50'}"
													>
														{#if checked}<Check class="size-3" aria-hidden="true" />{/if}
													</span>
													<span>{option.label}</span>
												</button>
											{/each}
										</div>
									{/if}
								</div>
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>

						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<Form.Field {form} name="referral">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>สถานะส่งต่อ</Form.Label>
										<button
											{...props}
											type="button"
											role="switch"
											aria-checked={referral}
											onclick={() => (referral = !referral)}
											class="flex min-h-9 w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {referral
												? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100'
												: 'border-border bg-background text-muted-foreground hover:bg-muted/40'}"
										>
											<span
												>{referral
													? 'ต้องส่งต่อเพื่อประเมินเพิ่มเติม'
													: 'ยังไม่ระบุการส่งต่อ'}</span
											>
											<span
												class="relative h-5 w-9 rounded-full {referral
													? 'bg-amber-600'
													: 'bg-muted-foreground/30'}"
											>
												<span
													class="absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform {referral
														? 'translate-x-4'
														: 'translate-x-0.5'}"
												></span>
											</span>
										</button>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field {form} name="screeningNotes">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>บันทึกการคัดกรองล่าสุด</Form.Label>
										<Textarea
											{...props}
											id="health-screening-notes"
											bind:value={screeningNotes}
											rows={3}
											placeholder="เพิ่มข้อสังเกตหรือคำแนะนำสำหรับทีมดูแล"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field {form} name="medicalNotes" class="sm:col-span-2">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>บันทึกการดูแลต่อเนื่อง</Form.Label>
										<Textarea
											{...props}
											id="health-medical-notes"
											bind:value={medicalNotes}
											rows={3}
											placeholder="เพิ่มข้อมูลที่ต้องติดตามระหว่างพักพิง"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>
					</section>

					{#if validationError}
						<p
							class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"
							role="alert"
							aria-live="polite"
						>
							{validationError}
						</p>
					{/if}
				</div>

				<footer
					class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-sm sm:px-5"
				>
					<Button type="button" variant="outline" onclick={onClose} disabled={saving}>ยกเลิก</Button
					>
					<Button type="submit" disabled={saving} class="min-w-28">
						{#if saving}
							<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
							กำลังบันทึก
						{:else}
							บันทึกข้อมูล
						{/if}
					</Button>
				</footer>
			</form>
		</div>
	</div>
{/if}
