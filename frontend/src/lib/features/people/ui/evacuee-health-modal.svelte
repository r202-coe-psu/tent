<script lang="ts">
	import { untrack } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
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
	import HealthMedicalFields from './forms/health-medical-fields.svelte';
	import EwarSymptomsFields from './forms/ewar-symptoms-fields.svelte';
	import SpecialNeedsFields from './forms/special-needs-fields.svelte';

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
				<div class="space-y-6 p-4 sm:p-5">
					<HealthMedicalFields
						bind:blood_group={bloodGroup}
						bind:care_track={careTrack}
						bind:conditions
						bind:medications
						bind:allergies
						bind:medical_notes={medicalNotes}
						bind:screening_notes={screeningNotes}
						bind:referral
						disabled={saving}
					/>

					<div class="border-t border-border pt-4">
						<EwarSymptomsFields
							bind:symptoms={selectedSymptoms}
							bind:temperature_c={temperature}
							{temperatureError}
							disabled={saving}
						/>
					</div>

					<div class="border-t border-border pt-4">
						<SpecialNeedsFields bind:special_needs={specialNeeds} disabled={saving} />
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
