<script lang="ts">
	import { toast } from 'svelte-sonner';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Save from '@lucide/svelte/icons/save';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import FileText from '@lucide/svelte/icons/file-text';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';

	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';

	import {
		EwarSymptomsFields,
		useRecordMedicalScreening,
		useMedicals,
		type Evacuee,
		type CareTrack,
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

	const careTrackOptions: { value: CareTrack; label: string; desc: string }[] = [
		{
			value: 'normal',
			label: 'ดูแลตามปกติ (Normal)',
			desc: 'ไม่มีภาวะเร่งด่วน จัดกลุ่มการดูแลตามปกติ'
		},
		{
			value: 'fast_track',
			label: 'Fast track',
			desc: 'มีภาวะเร่งด่วนหรือต้องการการติดตามอย่างใกล้ชิด'
		}
	];

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

	// Section 1: Health History & Care Track
	let conditions = $state<string>('');
	let medications = $state<string>('');
	let allergies = $state<string>('');
	let care_track = $state<CareTrack>('normal');

	// Section 2: General symptoms (free-text)
	let general_symptoms = $state<string>('');

	// Section 3: EWAR surveillance symptoms
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
					}
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

		<!-- Section 1: Health history & care track -->
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

			<div class="space-y-3">
				<div class="space-y-1.5">
					<Label class="text-xs font-semibold text-foreground">แนวทางดูแล (Care Track)</Label>
					<RadioGroup.Root
						value={care_track}
						onValueChange={(v) => {
							if (v === 'normal' || v === 'fast_track') care_track = v;
						}}
						disabled={isSubmitting}
						class="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
					>
						{#each careTrackOptions as opt (opt.value)}
							{@const selected = care_track === opt.value}
							<label
								for="care-track-{opt.value}"
								class="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all {selected
									? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary'
									: 'border-border bg-card hover:bg-muted/30'}"
							>
								<RadioGroup.Item value={opt.value} id="care-track-{opt.value}" class="mt-0.5" />
								<div class="space-y-0.5">
									<span class="block text-xs font-semibold text-foreground">{opt.label}</span>
									<span class="block text-xs text-muted-foreground">{opt.desc}</span>
								</div>
							</label>
						{/each}
					</RadioGroup.Root>
				</div>

				<div class="grid grid-cols-1 gap-3 pt-2 md:grid-cols-3">
					<div class="space-y-1.5">
						<Label for="med-conditions" class="text-xs font-medium text-foreground">
							โรคประจำตัว
						</Label>
						<Textarea
							id="med-conditions"
							bind:value={conditions}
							disabled={isSubmitting}
							rows={3}
							placeholder="เช่น เบาหวาน, โรคหัวใจ, หอบหืด"
							class="text-xs"
						/>
					</div>

					<div class="space-y-1.5">
						<Label for="med-medications" class="text-xs font-medium text-foreground">
							ยาที่ใช้ประจำ
						</Label>
						<Textarea
							id="med-medications"
							bind:value={medications}
							disabled={isSubmitting}
							rows={3}
							placeholder="เช่น ยาลดความดัน, อินซูลิน"
							class="text-xs"
						/>
					</div>

					<div class="space-y-1.5">
						<Label for="med-allergies" class="text-xs font-medium text-foreground">
							ประวัติการแพ้
						</Label>
						<Textarea
							id="med-allergies"
							bind:value={allergies}
							disabled={isSubmitting}
							rows={3}
							placeholder="เช่น เพนิซิลลิน, อาหารทะเล"
							class="text-xs"
						/>
					</div>
				</div>
			</div>
		</div>

		<!-- Section 2: General symptoms (free-text textarea) -->
		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<FileText class="size-4 text-primary" />
				<div>
					<h3 class="text-sm font-bold text-foreground">2. อาการทั่วไป (General Symptoms)</h3>
					<p class="text-xs text-muted-foreground">
						บันทึกอาการที่พบเบื้องต้นหรือข้อสังเกตของผู้ประสบภัยแบบข้อความอิสระ
					</p>
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="general-symptoms" class="text-xs font-medium text-foreground">
					อาการและข้อสังเกต
				</Label>
				<Textarea
					id="general-symptoms"
					bind:value={general_symptoms}
					disabled={isSubmitting}
					rows={3}
					placeholder="กรอกอาการทั่วไป เช่น ปวดศีรษะ เวียนศีรษะ ปวดเมื่อยตัว อ่อนเพลีย บาดแผล ฯลฯ (เว้นว่างได้ถ้าไม่มีอาการ)"
					class="text-xs"
				/>
			</div>
		</div>

		<!-- Section 3: EWAR surveillance symptoms (checkboxes) -->
		<div class="space-y-3 rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
			<div class="flex items-center gap-2 border-b border-border/60 pb-2.5">
				<AlertCircle class="size-4 text-primary" />
				<div>
					<h3 class="text-sm font-bold text-foreground">
						3. อาการเฝ้าระวังทางระบาดวิทยา (EWAR Surveillance Symptoms)
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
