<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		useShelter,
		useCreateShelter,
		useUpdateShelter,
		shelterSchema,
		BasicInfoSection,
		CapacitySection,
		ZonesFacilitiesSection,
		UtilitiesSection,
		RiskSection,
		AdmissionPolicySection,
		LuggagePolicySection,
		ParkingPolicySection,
		EMPTY_ADMISSION_POLICY,
		EMPTY_LUGGAGE_POLICY,
		EMPTY_PARKING_POLICY
	} from '$lib/features/shelters';
	import X from '@lucide/svelte/icons/x';
	import Save from '@lucide/svelte/icons/save';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Users from '@lucide/svelte/icons/users';
	import Zap from '@lucide/svelte/icons/zap';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Car from '@lucide/svelte/icons/car';

	let {
		id = '',
		isEdit,
		basePath
	}: {
		id?: string;
		isEdit: boolean;
		basePath?: string;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/back-office/shelters'));

	const shelterQuery = useShelter(() => id);
	const createMutation = useCreateShelter();
	const updateMutation = useUpdateShelter();

	const form = superForm(defaults(zod4(shelterSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(shelterSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
				return;
			}

			const data = validated.data;

			if (isEdit) {
				updateMutation.mutate(
					{ code: id, input: data },
					{ onSuccess: () => goto(resolvedBasePath) }
				);
			} else {
				createMutation.mutate(data, {
					onSuccess: () => goto(resolvedBasePath)
				});
			}
		}
	});

	const { form: formData, submitting, enhance, validateForm } = form;

	// Ensure nested optional objects exist so child sections can bind safely.
	// Done synchronously at form-init time (not inside $effect) to avoid the
	// reactive loop that reads then writes the same $formData keys.
	if (!$formData.location) $formData.location = {};
	if (!$formData.contact) $formData.contact = {};
	if (!$formData.key_personnel)
		$formData.key_personnel = { eoc_liaison: {}, medical_lead: {}, kitchen_lead: {} };
	if (!$formData.admission_policy) $formData.admission_policy = { ...EMPTY_ADMISSION_POLICY };
	if (!$formData.luggage_policy) $formData.luggage_policy = { ...EMPTY_LUGGAGE_POLICY };
	if (!$formData.parking_policy) $formData.parking_policy = { ...EMPTY_PARKING_POLICY };

	// Populate form data when edit query loads.
	$effect(() => {
		if (shelterQuery.data) {
			const d = shelterQuery.data;
			$formData = {
				name: d.name,
				operation_status: d.operation_status,
				shelter_type: d.shelter_type ?? null,
				project_level: d.project_level ?? null,
				location: d.location ?? {},
				contact: d.contact ?? {},
				municipality_zone: d.municipality_zone ?? null,
				community: d.community ?? null,
				address_no: d.address_no ?? null,
				village_no: d.village_no ?? null,
				subdistrict: d.subdistrict ?? null,
				district: d.district ?? null,
				province: d.province ?? null,
				postal_code: d.postal_code ?? null,
				key_personnel: d.key_personnel ?? { eoc_liaison: {}, medical_lead: {}, kitchen_lead: {} },
				capacity: d.capacity,
				area_m2: d.area_m2 ?? null,
				area_type: (d.area_type ?? null) as (typeof $formData)['area_type'],
				facilities: d.facilities ?? {},
				common_areas: d.common_areas ?? { sub_storage: [] },
				utilities: d.utilities ?? { communications: [] },
				risk: d.risk ?? {},
				zones: d.zones ?? [],
				admission_policy: d.admission_policy ?? { ...EMPTY_ADMISSION_POLICY },
				luggage_policy: d.luggage_policy ?? { ...EMPTY_LUGGAGE_POLICY },
				parking_policy: d.parking_policy ?? { ...EMPTY_PARKING_POLICY }
			};
		}
	});

	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
	const isLoading = $derived(isEdit ? shelterQuery.isLoading : false);
	const isError = $derived(isEdit ? shelterQuery.isError : false);
	const errorMessage = $derived(isEdit ? (shelterQuery.error?.message ?? '') : '');

	// Wizard steps (CR-023 Addendum A — tab/sidebar navigation).
	const steps = [
		{ label: 'ข้อมูลพื้นฐานและที่ตั้ง', icon: MapPin },
		{ label: 'ข้อมูลความจุเชิงพื้นที่', icon: Building2 },
		{ label: 'โซนและสิ่งอำนวยความสะดวก', icon: Users },
		{ label: 'สถานะสาธารณูปโภคพื้นฐาน', icon: Zap },
		{ label: 'ประเมินความเสี่ยงและโครงสร้าง', icon: ShieldAlert },
		{ label: 'นโยบายการรับผู้อพยพ', icon: PawPrint },
		{ label: 'นโยบายทรัพย์สิน / สัมภาระ', icon: Briefcase },
		{ label: 'นโยบายยานพาหนะ', icon: Car }
	];
	let step = $state(0);
	const isLastStep = $derived(step === steps.length - 1);

	function goPrev() {
		if (step > 0) step -= 1;
	}
	const stepFields = [
		['name'],
		['capacity'],
		['zones', 'facilities', 'common_areas'],
		['utilities'],
		['risk'],
		['admission_policy'],
		['luggage_policy'],
		['parking_policy']
	];

	async function goNext() {
		if (step >= steps.length - 1) return;

		const result = await validateForm({ update: true, focusOnError: true });
		const errors = result.errors as Record<string, unknown> | undefined;
		const hasStepErrors = stepFields[step].some((field) => errors && field in errors);

		if (hasStepErrors) {
			toast.error('กรุณากรอกข้อมูลในขั้นตอนนี้ให้ครบถ้วนและถูกต้อง');
			return;
		}

		step += 1;
	}

	// Guard native implicit submit: Enter in a text input must not save/redirect
	// mid-wizard. Only allow the form to submit from the last step (where the
	// real "บันทึกข้อมูล" button lives). Enter inside a <textarea> is left alone.
	function onFormKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (event.key === 'Enter' && !isLastStep && target?.tagName !== 'TEXTAREA') {
			event.preventDefault();
		}
	}
</script>

<main class="text-[13px] text-foreground">
	<div
		class="sticky top-0 z-10 flex items-center justify-between border-b border-shelter-border bg-background/95 px-6 py-4 backdrop-blur-sm"
	>
		<div class="flex items-center space-x-2">
			<a
				href={resolvedBasePath}
				class="mr-1 rounded-lg p-2 transition hover:bg-muted/50"
				title="ปิด"
			>
				<X class="h-4 w-4 text-muted-foreground" />
			</a>
			<h1 class="text-2xl font-bold tracking-tight text-foreground">
				{isEdit ? 'แก้ไขข้อมูลศูนย์พักพิง' : 'สร้างศูนย์พักพิงใหม่'}
			</h1>
		</div>
		<div class="flex items-center gap-2">
			<a
				href={resolvedBasePath}
				class="rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/50"
			>
				ยกเลิก
			</a>
			<Button type="submit" form="shelter-form" disabled={$submitting || isPending}>
				<Save class="h-4 w-4" />
				<span>{isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
			</Button>
		</div>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-20 text-muted-foreground">
			กำลังโหลดข้อมูลศูนย์พักพิง...
		</div>
	{:else if isError}
		<div class="flex flex-col items-center justify-center space-y-2 py-20 text-destructive">
			<span>เกิดข้อผิดพลาดในการดึงข้อมูล</span>
			<span class="text-xs text-muted-foreground">{errorMessage}</span>
			<a href={resolvedBasePath} class="text-muted-foreground underline">กลับหน้ารวม</a>
		</div>
	{:else}
		<div class="flex flex-col gap-6 p-6 md:flex-row">
			<!-- Sidebar category nav -->
			<nav
				class="shrink-0 md:sticky md:top-20 md:max-h-[calc(100dvh-6rem)] md:w-64 md:self-start md:overflow-y-auto md:rounded-2xl md:border md:border-shelter-border md:bg-background/90 md:p-3 md:shadow-sm md:backdrop-blur-sm"
			>
				<div class="mb-3 flex items-center justify-between gap-3 px-2">
					<p class="text-xs font-bold tracking-wider text-muted-foreground uppercase">
						หมวดหมู่ข้อมูล
					</p>
					<span class="text-[11px] font-semibold text-muted-foreground tabular-nums">
						{step + 1} / {steps.length}
					</span>
				</div>
				<ul class="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
					{#each steps as s, i (s.label)}
						{@const Icon = s.icon}
						<li class="shrink-0">
							<button
								type="button"
								onclick={() => (step = i)}
								aria-current={step === i ? 'step' : undefined}
								class={[
									'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200',
									step === i
										? 'bg-primary text-white shadow-sm'
										: 'text-muted-foreground hover:-translate-y-px hover:bg-muted/50 hover:text-foreground'
								]}
							>
								<Icon class="h-4 w-4 shrink-0" />
								<span class="whitespace-nowrap md:whitespace-normal">{s.label}</span>
							</button>
						</li>
					{/each}
				</ul>
			</nav>

			<!-- Step content -->
			<div class="min-w-0 flex-1">
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<!-- keydown guards native implicit submit (Enter) to the last wizard step only -->
				<form id="shelter-form" method="POST" use:enhance onkeydown={onFormKeydown}>
					<div class={[step !== 0 && 'hidden']}>
						<BasicInfoSection {form} {formData} />
					</div>
					<div class={[step !== 1 && 'hidden']}>
						<CapacitySection {form} {formData} />
					</div>
					<div class={[step !== 2 && 'hidden']}>
						<ZonesFacilitiesSection {form} {formData} shelterCode={id} />
					</div>
					<div class={[step !== 3 && 'hidden']}>
						<UtilitiesSection {form} {formData} />
					</div>
					<div class={[step !== 4 && 'hidden']}>
						<RiskSection {form} {formData} />
					</div>
					<div class={[step !== 5 && 'hidden']}>
						<AdmissionPolicySection {formData} />
					</div>
					<div class={[step !== 6 && 'hidden']}>
						<LuggagePolicySection {formData} />
					</div>
					<div class={[step !== 7 && 'hidden']}>
						<ParkingPolicySection {formData} />
					</div>

					<!-- Bottom navigation -->
					<div class="mt-6 flex items-center justify-between border-t border-shelter-border pt-6">
						<Button type="button" variant="outline" onclick={goPrev} disabled={step === 0}>
							<ArrowLeft class="h-4 w-4" />
							<span>ก่อนหน้า</span>
						</Button>

						{#if !isLastStep}
							<Button type="button" onclick={goNext}>
								<span>ถัดไป</span>
								<ArrowRight class="h-4 w-4" />
							</Button>
						{/if}
					</div>
				</form>
			</div>
		</div>
	{/if}
</main>
