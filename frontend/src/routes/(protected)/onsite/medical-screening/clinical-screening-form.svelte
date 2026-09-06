<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Activity from '@lucide/svelte/icons/activity';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import History from '@lucide/svelte/icons/history';
	import Save from '@lucide/svelte/icons/save';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';

	import {
		EwarSymptomsFields,
		HealthMedicalFields,
		useRecordMedicalScreening,
		useMedicals,
		type Evacuee,
		type BloodGroup,
		type CareTrack,
		type TriageLevel,
		type Screening
	} from '$lib/features/people';
	import { useMasterData } from '$lib/features/master-data';
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

	const vulnerableGroupQuery = safeQuery(() => useMasterData(() => 'vulnerable_group'), {
		data: undefined
	} as ReturnType<typeof useMasterData>);

	const SPECIAL_NEED_LABELS: Record<string, string> = {
		wheelchair: 'ใช้วีลแชร์',
		bedridden: 'ผู้ป่วยติดเตียง',
		oxygen: 'ใช้ออกซิเจน',
		pregnant: 'หญิงตั้งครรภ์',
		infant: 'ทารก/เด็กเล็ก',
		visual_impaired: 'ผู้พิการทางการมองเห็น',
		hearing_impaired: 'ผู้พิการทางการได้ยิน',
		high_dependency: 'มีภาวะพึ่งพิงสูง',
		elderly: 'ผู้สูงอายุ',
		chronic_illness: 'โรคเรื้อรัง',
		disabled: 'ผู้พิการ'
	};

	function getSpecialNeedLabel(need: string): string {
		const fromMaster = vulnerableGroupQuery.data?.items.find((i) => i.code === need)?.label;
		if (fromMaster) return fromMaster;
		const fromLegacy = SPECIAL_NEED_LABELS[need];
		if (fromLegacy) return fromLegacy;
		if (need.startsWith('item_')) return '—';
		return need;
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

	let temperature_c = $state<number | null>(null);
	let blood_pressure_sys = $state<number | null>(null);
	let blood_pressure_dia = $state<number | null>(null);
	let heart_rate = $state<number | null>(null);
	let spo2_percent = $state<number | null>(null);
	let symptoms = $state<string[]>([]);
	let blood_group = $state<BloodGroup>('unknown');
	let conditions = $state<string>('');
	let medications = $state<string>('');
	let allergies = $state<string>('');
	let medical_notes = $state<string>('');
	let triage_level = $state<TriageLevel>('green');
	let care_track = $state<CareTrack>('normal');
	let screening_notes = $state<string>('');
	let referral = $state<boolean>(false);
	let isSubmitting = $state<boolean>(false);
	let lastLoadedEvacueeId = $state<string | null>(null);
	let baselineSnapshot = $state<string>('');

	function currentSnapshot(): string {
		return JSON.stringify({
			temperature_c,
			blood_pressure_sys,
			blood_pressure_dia,
			heart_rate,
			spo2_percent,
			symptoms,
			blood_group,
			conditions,
			medications,
			allergies,
			medical_notes,
			triage_level,
			care_track,
			screening_notes,
			referral
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

		const existingMedical = medicals.find((m) => m.evacuee_id === evacuee._id);
		if (existingMedical) {
			if (existingMedical.blood_group) blood_group = existingMedical.blood_group;
			if (existingMedical.conditions?.length) conditions = existingMedical.conditions.join(', ');
			if (existingMedical.medications?.length) medications = existingMedical.medications.join(', ');
			if (existingMedical.allergies?.length) allergies = existingMedical.allergies.join(', ');
			if (existingMedical.notes) medical_notes = existingMedical.notes;
			if (existingMedical.track) care_track = existingMedical.track;
		}

		const latest = priorScreening?.latest;
		if (latest) {
			if (latest.symptoms?.length) symptoms = [...latest.symptoms];
			if (latest.temperature_c != null) temperature_c = latest.temperature_c;
			if (latest.triage_level) triage_level = latest.triage_level;
			if (latest.track) care_track = latest.track;
			if (latest.needs_referral != null) referral = latest.needs_referral;
			if (latest.notes) screening_notes = latest.notes;
			if (latest.vital_signs) {
				if (latest.vital_signs.blood_pressure_sys != null)
					blood_pressure_sys = latest.vital_signs.blood_pressure_sys;
				if (latest.vital_signs.blood_pressure_dia != null)
					blood_pressure_dia = latest.vital_signs.blood_pressure_dia;
				if (latest.vital_signs.heart_rate != null) heart_rate = latest.vital_signs.heart_rate;
				if (latest.vital_signs.spo2_percent != null) spo2_percent = latest.vital_signs.spo2_percent;
			}
		}

		baselineSnapshot = currentSnapshot();
	});

	function formatScreenedAt(iso?: string | null): string {
		if (!iso) return '—';
		try {
			const d = new Date(iso);
			return (
				d.toLocaleString('th-TH', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				}) + ' น.'
			);
		} catch {
			return iso;
		}
	}

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

			const hasMedicalData =
				blood_group !== 'unknown' ||
				conditionsArr.length > 0 ||
				medicationsArr.length > 0 ||
				allergiesArr.length > 0 ||
				medical_notes.trim().length > 0;

			await recordMutation.mutateAsync({
				input: {
					screening: {
						evacuee_id: evacuee._id,
						track: care_track,
						triage_level,
						needs_referral: referral,
						symptoms,
						temperature_c,
						notes: [screening_notes, medical_notes].filter(Boolean).join('\n') || undefined,
						blood_pressure_sys: blood_pressure_sys !== null ? Number(blood_pressure_sys) : null,
						blood_pressure_dia: blood_pressure_dia !== null ? Number(blood_pressure_dia) : null,
						heart_rate: heart_rate !== null ? Number(heart_rate) : null,
						spo2_percent: spo2_percent !== null ? Number(spo2_percent) : null
					},
					...(hasMedicalData
						? {
								medical: {
									evacuee_id: evacuee._id,
									blood_group,
									conditions: conditionsArr,
									medications: medicationsArr,
									allergies: allergiesArr,
									track: care_track,
									notes: medical_notes.trim() || undefined
								}
							}
						: {})
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
		{#if priorScreening && priorScreening.screeningCount > 0}
			<div
				class="rounded-xl border border-sky-500/30 bg-sky-50/80 p-3.5 dark:bg-sky-950/30"
				data-testid="re-edit-banner"
			>
				<div class="mb-1 flex items-center gap-2">
					<History class="size-4 text-sky-600 dark:text-sky-400" />
					<span class="text-xs font-bold text-sky-900 dark:text-sky-100">
						แก้ไขผลการคัดกรอง (บันทึกใหม่แบบ append)
					</span>
				</div>
				<p class="text-xs leading-relaxed text-sky-800 dark:text-sky-200">
					เคยตรวจแล้ว {priorScreening.screeningCount} ครั้ง · ล่าสุด
					{formatScreenedAt(priorScreening.lastScreenedAt)}
					{#if priorScreening.lastScreenedBy}
						· โดย {priorScreening.lastScreenedBy}
					{/if}
				</p>
			</div>
		{/if}

		{#if (evacuee.vulnerable_groups && evacuee.vulnerable_groups.length > 0) || (evacuee.special_needs && evacuee.special_needs.length > 0)}
			<div class="rounded-xl border border-amber-500/30 bg-amber-50/70 p-3.5 dark:bg-amber-950/20">
				<div class="mb-1.5 flex items-center gap-2">
					<ShieldAlert class="size-4 text-amber-600 dark:text-amber-400" />
					<span class="text-xs font-bold text-amber-900 dark:text-amber-200">
						กลุ่มเปราะบาง / ความต้องการพิเศษ
					</span>
				</div>
				<div class="flex flex-wrap gap-1.5">
					{#each evacuee.vulnerable_groups ?? [] as need (need)}
						<Badge variant="outline" class="border-primary/40 bg-primary/10 text-xs text-primary">
							{getSpecialNeedLabel(need)}
						</Badge>
					{/each}
					{#each evacuee.special_needs ?? [] as need (need)}
						<Badge
							variant="outline"
							class="border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300"
						>
							{getSpecialNeedLabel(need)}
						</Badge>
					{/each}
				</div>
			</div>
		{/if}

		<div class="space-y-4 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<Activity class="size-4 text-emerald-600 dark:text-emerald-400" />
				<h3 class="text-sm font-bold text-foreground">
					สัญญาณชีพ (Vital Signs) &amp; อุณหภูมิร่างกาย
				</h3>
			</div>

			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<div class="space-y-1.5">
					<Label for="vital-bp-sys" class="text-xs font-semibold text-foreground">
						ความดันโลหิตบน (Sys)
					</Label>
					<div class="relative flex items-center">
						<Input
							id="vital-bp-sys"
							type="number"
							placeholder="120"
							bind:value={blood_pressure_sys}
							min="50"
							max="300"
							class="pr-12 text-xs"
							disabled={isSubmitting}
						/>
						<span class="pointer-events-none absolute right-2.5 text-2xs text-muted-foreground">
							mmHg
						</span>
					</div>
				</div>
				<div class="space-y-1.5">
					<Label for="vital-bp-dia" class="text-xs font-semibold text-foreground">
						ความดันโลหิตล่าง (Dia)
					</Label>
					<div class="relative flex items-center">
						<Input
							id="vital-bp-dia"
							type="number"
							placeholder="80"
							bind:value={blood_pressure_dia}
							min="30"
							max="200"
							class="pr-12 text-xs"
							disabled={isSubmitting}
						/>
						<span class="pointer-events-none absolute right-2.5 text-2xs text-muted-foreground">
							mmHg
						</span>
					</div>
				</div>
				<div class="space-y-1.5">
					<Label for="vital-hr" class="text-xs font-semibold text-foreground">
						ชีพจร (Heart Rate)
					</Label>
					<div class="relative flex items-center">
						<Input
							id="vital-hr"
							type="number"
							placeholder="72"
							bind:value={heart_rate}
							min="30"
							max="250"
							class="pr-10 text-xs"
							disabled={isSubmitting}
						/>
						<span class="pointer-events-none absolute right-2.5 text-2xs text-muted-foreground">
							bpm
						</span>
					</div>
				</div>
				<div class="space-y-1.5">
					<Label for="vital-spo2" class="text-xs font-semibold text-foreground">
						ระดับออกซิเจน (SpO2)
					</Label>
					<div class="relative flex items-center">
						<Input
							id="vital-spo2"
							type="number"
							placeholder="98"
							bind:value={spo2_percent}
							min="50"
							max="100"
							class="pr-8 text-xs"
							disabled={isSubmitting}
						/>
						<span class="pointer-events-none absolute right-2.5 text-2xs text-muted-foreground">
							%
						</span>
					</div>
				</div>
			</div>
		</div>

		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<EwarSymptomsFields
				bind:symptoms
				bind:temperature_c
				disabled={isSubmitting}
				showTemperature={true}
			/>
		</div>

		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<HealthMedicalFields
				bind:blood_group
				bind:conditions
				bind:medications
				bind:allergies
				bind:medical_notes
				bind:triage_level
				bind:care_track
				bind:screening_notes
				bind:referral
				disabled={isSubmitting}
			/>
		</div>
	</div>

	<div
		class="sticky bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6"
	>
		<Button
			type="button"
			onclick={handleSubmit}
			disabled={isSubmitting}
			class="h-11 w-full gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700"
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
