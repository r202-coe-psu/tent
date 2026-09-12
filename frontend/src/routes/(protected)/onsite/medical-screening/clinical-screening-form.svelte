<script lang="ts">
	import { toast } from 'svelte-sonner';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Save from '@lucide/svelte/icons/save';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';

	import { Button } from '$lib/components/ui/button';

	import {
		EwarSymptomsFields,
		HealthMedicalFields,
		SpecialNeedsFields,
		VulnerableGroupsFields,
		useRecordMedicalScreening,
		useMedicals,
		type Evacuee,
		type CareTrack,
		type Screening
	} from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';

	type PriorScreeningContext = {
		screeningCount: number;
		lastScreenedAt?: string | null;
		lastScreenedBy?: string | null;
		latest?: Screening | null;
	};

	let {
		evacuee,
		priorScreening = null,
		onDirtyChange,
		onSuccess
	}: {
		evacuee: Evacuee;
		priorScreening?: PriorScreeningContext | null;
		onDirtyChange?: (dirty: boolean) => void;
		/** Called after a successful save; parent shows Station 3 / queue CTAs. */
		onSuccess?: (evacueeId: string) => void;
	} = $props();

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const recordMutation = safeQuery(() => useRecordMedicalScreening(), {
		mutateAsync: async () => ({
			screening: undefined as never
		})
	} as unknown as ReturnType<typeof useRecordMedicalScreening>);

	const medicalsQuery = safeQuery(() => useMedicals(), {
		data: undefined,
		isLoading: false,
		isError: false
	} as ReturnType<typeof useMedicals>);

	// Section 1: Health History & Care Track (+ general symptoms)
	let conditions = $state<string>('');
	let medications = $state<string>('');
	let allergies = $state<string>('');
	let care_track = $state<CareTrack>('normal');
	let general_symptoms = $state<string>('');

	// Section 2: Vulnerable Groups (editable, prefilled from Station 1)
	let vulnerable_groups = $state<string[]>([]);

	// Section 3: Additional needs (editable, prefilled from Station 1)
	let special_needs = $state<string[]>([]);

	// Section 4: EWAR surveillance symptoms
	let symptoms = $state<string[]>([]);

	let isSubmitting = $state<boolean>(false);
	let lastLoadedEvacueeId = $state<string | null>(null);
	let baselineSnapshot = $state<string>('');

	function currentSnapshot(): string {
		return JSON.stringify({
			conditions: conditions.trim(),
			medications: medications.trim(),
			allergies: allergies.trim(),
			care_track,
			general_symptoms: general_symptoms.trim(),
			vulnerable_groups: [...vulnerable_groups].sort(),
			special_needs: [...special_needs].sort(),
			symptoms: [...symptoms].sort()
		});
	}

	const isDirty = $derived(baselineSnapshot !== '' && currentSnapshot() !== baselineSnapshot);

	$effect(() => {
		onDirtyChange?.(isDirty);
	});

	$effect(() => {
		const medicals = medicalsQuery.data;
		if (medicals === undefined) return;
		if (evacuee._id === lastLoadedEvacueeId) return;
		lastLoadedEvacueeId = evacuee._id;

		vulnerable_groups = [...(evacuee.vulnerable_groups ?? [])];
		special_needs = [...(evacuee.special_needs ?? [])];

		const existingMedical = medicals.find((m) => m.evacuee_id === evacuee._id);
		if (existingMedical) {
			if (existingMedical.conditions?.length) conditions = existingMedical.conditions.join(', ');
			if (existingMedical.medications?.length) medications = existingMedical.medications.join(', ');
			if (existingMedical.allergies?.length) allergies = existingMedical.allergies.join(', ');
			if (existingMedical.track) care_track = existingMedical.track;
		}

		const latest = priorScreening?.latest;
		if (latest) {
			if (latest.symptoms?.length) symptoms = [...latest.symptoms];
			if (latest.track) care_track = latest.track;
			if (latest.notes) general_symptoms = latest.notes;
		}

		baselineSnapshot = currentSnapshot();
	});

	async function handleSubmit() {
		isSubmitting = true;
		try {
			const ctx = {
				shelterCode: evacuee.shelter_code || getShelterCode(),
				createdBy: authStore.user?.name || 'medical_staff'
			};

			const conditionsArr = conditions
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			const medicationsArr = medications
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			const allergiesArr = allergies
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);

			await recordMutation.mutateAsync({
				input: {
					screening: {
						evacuee_id: evacuee._id,
						track: care_track,
						symptoms,
						notes: general_symptoms.trim() || undefined
					},
					medical: {
						evacuee_id: evacuee._id,
						conditions: conditionsArr,
						medications: medicationsArr,
						allergies: allergiesArr,
						track: care_track
					},
					vulnerable_groups: [...vulnerable_groups],
					special_needs: [...special_needs]
				},
				ctx
			});

			baselineSnapshot = currentSnapshot();
			toast.success('บันทึกผลการคัดกรองแล้ว');
			onSuccess?.(evacuee._id);
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
		} finally {
			isSubmitting = false;
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="space-y-6 px-4 pt-2 pb-28 md:px-6">
		<!-- Section 1: Health history, care track & general symptoms -->
		<div class="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<HeartPulse class="size-4 text-primary" />
				<div>
					<h3 class="text-sm font-bold text-foreground">
						1. ประวัติสุขภาพและแนวทางดูแล (Health History &amp; Care Track)
					</h3>
					<p class="text-xs text-muted-foreground">
						ซักประวัติโรคประจำตัว ยาที่ใช้ประจำ ประวัติการแพ้ และจัดกลุ่มแนวทางดูแล
					</p>
				</div>
			</div>

			<HealthMedicalFields
				bind:care_track
				bind:conditions
				bind:medications
				bind:allergies
				bind:general_symptoms
				disabled={isSubmitting}
				idPrefix="med"
				showGeneralSymptoms={true}
			/>
		</div>

		<!-- Section 2: Vulnerable Groups (editable checkboxes) -->
		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<ShieldAlert class="size-4 text-primary" />
				<div>
					<h3 class="text-sm font-bold text-foreground">2. กลุ่มเปราะบาง (Vulnerable Groups)</h3>
					<p class="text-xs text-muted-foreground">เลือกได้หลายรายการ (ไม่บังคับ)</p>
				</div>
			</div>

			<VulnerableGroupsFields
				bind:vulnerable_groups
				disabled={isSubmitting}
				idPrefix="med-vg"
				label=""
			/>
		</div>

		<!-- Section 3: Additional needs -->
		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<HeartHandshake class="size-4 text-primary" />
				<div>
					<h3 class="text-sm font-bold text-foreground">
						3. ความต้องการเพิ่มเติม (Additional needs)
					</h3>
					<p class="text-xs text-muted-foreground">แท็กทั่วไปหรือเพิ่มความต้องการเอง (ไม่บังคับ)</p>
				</div>
			</div>

			<SpecialNeedsFields bind:special_needs disabled={isSubmitting} label="" />
		</div>

		<!-- Section 4: EWAR surveillance symptoms (checkboxes) -->
		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<AlertCircle class="size-4 text-primary" />
				<div>
					<h3 class="text-sm font-bold text-foreground">
						4. อาการเฝ้าระวังทางระบาดวิทยา (EWAR Surveillance Symptoms)
					</h3>
					<p class="text-xs text-muted-foreground">
						กลุ่มอาการเฝ้าระวังโรคระบาด — หากไม่มีอาการไม่ต้องติ๊กเลือก (ไม่บังคับเลือกอาการ)
					</p>
				</div>
			</div>

			<EwarSymptomsFields bind:symptoms disabled={isSubmitting} showTemperature={false} />
		</div>
	</div>

	<div
		class="sticky bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6"
	>
		<Button
			type="button"
			onclick={handleSubmit}
			disabled={isSubmitting}
			class="h-11 w-full gap-2 rounded-xl text-sm font-semibold shadow-xs"
		>
			{#if isSubmitting}
				<Loader2 class="size-4 animate-spin" />
				<span>กำลังบันทึกข้อมูล...</span>
			{:else}
				<Save class="size-4" />
				<span>บันทึกผลคัดกรอง</span>
			{/if}
		</Button>
	</div>
</div>
