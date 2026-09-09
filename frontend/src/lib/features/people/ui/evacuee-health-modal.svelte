<script lang="ts">
	import { untrack } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		evacueeHealthEditFormSchema,
		type BloodGroup,
		type CareTrack,
		type Evacuee,
		type Medical,
		type Screening
	} from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		EwarSymptomsFields,
		HealthMedicalFields,
		SpecialNeedsFields,
		VulnerableGroupsFields
	} from './forms/index.js';
	import ModalEscapeListener from './modal-escape-listener.svelte';

	export type EvacueeHealthEditData = {
		careTrack: CareTrack;
		conditions: string[];
		medications: string[];
		allergies: string[];
		generalSymptoms: string;
		vulnerableGroups: string[];
		specialNeeds: string[];
		ewarSymptoms: string[];
		// Legacy fields (optional for backwards compatibility)
		bloodGroup?: BloodGroup;
		medicalNotes?: string;
		screeningNotes?: string;
		temperatureC?: number | null;
		referral?: boolean;
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

	let careTrack = $state<CareTrack>('normal');
	let conditions = $state('');
	let medications = $state('');
	let allergies = $state('');
	let generalSymptoms = $state('');
	let vulnerableGroups = $state<string[]>([]);
	let specialNeeds = $state<string[]>([]);
	let selectedSymptoms = $state<string[]>([]);
	let saving = $state(false);
	let validationError = $state('');
	let lastOpenedEvacueeId = $state<string | null>(null);

	function snapshot() {
		return {
			careTrack: medical?.track ?? screening?.track ?? 'normal',
			conditions: (medical?.conditions ?? []).join(', '),
			medications: (medical?.medications ?? []).join(', '),
			allergies: (medical?.allergies ?? []).join(', '),
			generalSymptoms: screening?.notes ?? medical?.notes ?? '',
			vulnerableGroups: [...(evacuee.vulnerable_groups ?? [])],
			specialNeeds: [...(evacuee.special_needs ?? [])],
			selectedSymptoms: [...(screening?.symptoms ?? [])],
			bloodGroup: 'unknown' as BloodGroup,
			medicalNotes: medical?.notes ?? '',
			screeningNotes: screening?.notes ?? '',
			temperature: null,
			referral: false
		};
	}

	function resetForm() {
		const initial = untrack(snapshot);
		careTrack = initial.careTrack;
		conditions = initial.conditions;
		medications = initial.medications;
		allergies = initial.allergies;
		generalSymptoms = initial.generalSymptoms;
		vulnerableGroups = initial.vulnerableGroups;
		specialNeeds = initial.specialNeeds;
		selectedSymptoms = initial.selectedSymptoms;
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

	const form = superForm(defaults(snapshot(), zod4(evacueeHealthEditFormSchema)), {
		SPA: true,
		validators: zod4(evacueeHealthEditFormSchema),
		resetForm: false
	});
	const { form: formData, validateForm } = form;

	async function save() {
		$formData = {
			careTrack,
			conditions,
			medications,
			allergies,
			generalSymptoms,
			vulnerableGroups,
			specialNeeds,
			selectedSymptoms,
			bloodGroup: 'unknown',
			medicalNotes: '',
			screeningNotes: generalSymptoms,
			temperature: null,
			referral: false
		};
		const validation = await validateForm({ update: true, focusOnError: true });
		if (saving || !validation.valid) {
			if (!validation.valid) validationError = 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน';
			return;
		}

		saving = true;
		try {
			await onSave({
				careTrack: validation.data.careTrack,
				conditions: listFromText(validation.data.conditions),
				medications: listFromText(validation.data.medications),
				allergies: listFromText(validation.data.allergies),
				generalSymptoms: validation.data.generalSymptoms,
				vulnerableGroups: validation.data.vulnerableGroups,
				specialNeeds: validation.data.specialNeeds,
				ewarSymptoms: validation.data.selectedSymptoms
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
	<ModalEscapeListener open={show} disabled={saving} onEscape={onClose} />
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-xs sm:p-5"
		role="presentation"
	>
		<div
			class="flex max-h-[94vh] w-full max-w-3xl animate-in flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl duration-150 zoom-in-95 fade-in"
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
							แก้ไขข้อมูลสุขภาพ (Station 2 Medical Screening)
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
				<div class="space-y-6 p-4 sm:p-5">
					<!-- Section 1: Health history, care track & general symptoms -->
					<div class="space-y-4 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
						<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
							<HeartPulse class="size-4 text-primary" />
							<div>
								<h3 class="text-sm font-bold text-foreground">
									1. ประวัติสุขภาพและแนวทางดูแล (Health History &amp; Care Track)
								</h3>
								<p class="text-xs text-muted-foreground">
									กำหนดแนวทางดูแล ซักประวัติโรคประจำตัว ยาที่ใช้ประจำ ประวัติการแพ้ และอาการทั่วไป
								</p>
							</div>
						</div>

						<HealthMedicalFields
							bind:care_track={careTrack}
							bind:conditions
							bind:medications
							bind:allergies
							bind:general_symptoms={generalSymptoms}
							disabled={saving}
							idPrefix="edit"
							showGeneralSymptoms={true}
						/>
					</div>

					<!-- Section 2: Vulnerable Groups (CR112 checkbox grid) -->
					<div class="space-y-3 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
						<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
							<ShieldAlert class="size-4 text-primary" />
							<div>
								<h3 class="text-sm font-bold text-foreground">2. กลุ่มเปราะบาง (Vulnerable Groups)</h3>
								<p class="text-xs text-muted-foreground">เลือกได้หลายรายการ (ไม่บังคับ)</p>
							</div>
						</div>

						<VulnerableGroupsFields
							bind:vulnerable_groups={vulnerableGroups}
							disabled={saving}
							idPrefix="edit-vg"
							label=""
						/>
					</div>

					<!-- Section 3: Additional needs -->
					<div class="space-y-3 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
						<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
							<HeartHandshake class="size-4 text-primary" />
							<div>
								<h3 class="text-sm font-bold text-foreground">3. ความต้องการเพิ่มเติม (Additional needs)</h3>
								<p class="text-xs text-muted-foreground">
									แท็กทั่วไปหรือเพิ่มความต้องการพิเศษเอง (ไม่บังคับ)
								</p>
							</div>
						</div>

						<SpecialNeedsFields bind:special_needs={specialNeeds} disabled={saving} label="" />
					</div>

					<!-- Section 4: EWAR surveillance symptoms (without temperature) -->
					<div class="space-y-3 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
						<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
							<AlertCircle class="size-4 text-primary" />
							<div>
								<h3 class="text-sm font-bold text-foreground">
									4. อาการเฝ้าระวังทางระบาดวิทยา (EWAR Surveillance Symptoms)
								</h3>
								<p class="text-xs text-muted-foreground">
									กลุ่มอาการเฝ้าระวังโรคระบาด — หากไม่มีอาการไม่ต้องติ๊กเลือก
								</p>
							</div>
						</div>

						<EwarSymptomsFields
							bind:symptoms={selectedSymptoms}
							showTemperature={false}
							disabled={saving}
						/>
					</div>

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
					<Button type="button" variant="outline" onclick={onClose} disabled={saving}>ยกเลิก</Button>
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
