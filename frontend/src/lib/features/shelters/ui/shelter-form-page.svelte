<script lang="ts">
	import { tick } from 'svelte';
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
		type SiteKind,
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
	import { UserManagementPage } from '$lib/features/users';
	import {
		SHELTER_STEP_FIELDS,
		collectErrorMessages,
		collectErrorMessagesForFields,
		findInvalidStepIndexes,
		stepHasFieldErrors
	} from './shelter-form-validation';
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
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import UserCog from '@lucide/svelte/icons/user-cog';

	let {
		id = '',
		isEdit,
		basePath,
		siteKind
	}: {
		id?: string;
		isEdit: boolean;
		basePath?: string;
		siteKind?: SiteKind;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/back-office/shelters'));

	const shelterQuery = useShelter(() => id);
	const createMutation = useCreateShelter();
	const updateMutation = useUpdateShelter();

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
	let showValidationSummary = $state(false);
	/** View switch (not a wizard step): users for this shelter. */
	let usersViewActive = $state(false);
	const isLastStep = $derived(!usersViewActive && step === steps.length - 1);

	function selectStep(i: number) {
		usersViewActive = false;
		step = i;
	}

	const form = superForm(defaults(zod4(shelterSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(shelterSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				showValidationSummary = true;
				await revealValidationIssues(validated.errors);
				return;
			}

			showValidationSummary = false;
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

	const { form: formData, submitting, enhance, validateForm, errors } = form;

	const stepsWithErrors = $derived.by(() => {
		if (!showValidationSummary) return [] as number[];
		return findInvalidStepIndexes($errors);
	});

	const validationMessages = $derived.by(() => {
		if (!showValidationSummary) return [] as string[];
		return collectErrorMessages($errors);
	});

	const stepsWithErrorsSet = $derived(new Set(stepsWithErrors));

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

	$effect(() => {
		if (!isEdit && siteKind && !$formData.site_kind) $formData.site_kind = siteKind;
	});

	// Populate form data when edit query loads.
	$effect(() => {
		if (shelterQuery.data) {
			const d = shelterQuery.data;
			$formData = {
				name: d.name,
				site_kind: d.site_kind,
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

	function goPrev() {
		if (step > 0) step -= 1;
	}

	async function revealValidationIssues(formErrors: unknown) {
		const invalidSteps = findInvalidStepIndexes(formErrors);
		const messages = collectErrorMessages(formErrors);

		if (invalidSteps.length > 0 && invalidSteps[0] !== step) {
			step = invalidSteps[0]!;
			await tick();
		}

		const firstInvalid = document.querySelector<HTMLElement>('#shelter-form [aria-invalid="true"]');
		firstInvalid?.focus();
		firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });

		const categoryLabels = invalidSteps.map((i) => steps[i]?.label).filter(Boolean);
		const descriptionParts: string[] = [];
		if (categoryLabels.length > 0) {
			descriptionParts.push(`หมวดที่ต้องแก้: ${categoryLabels.join(', ')}`);
		}
		if (messages.length > 0) {
			descriptionParts.push(messages.slice(0, 4).join('\n'));
			if (messages.length > 4) {
				descriptionParts.push(`และอีก ${messages.length - 4} รายการ`);
			}
		}

		toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง', {
			description: descriptionParts.length > 0 ? descriptionParts.join('\n') : undefined,
			duration: 8000
		});
	}

	async function goNext() {
		if (step >= steps.length - 1) return;

		const result = await validateForm({ update: true, focusOnError: false });
		if (stepHasFieldErrors(step, result.errors)) {
			await tick();
			const firstInvalid = document.querySelector<HTMLElement>(
				'#shelter-form [aria-invalid="true"]'
			);
			firstInvalid?.focus();
			firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });

			const stepMessages = collectErrorMessagesForFields(
				result.errors,
				SHELTER_STEP_FIELDS[step] ?? []
			);
			toast.error('กรุณากรอกข้อมูลในขั้นตอนนี้ให้ครบถ้วนและถูกต้อง', {
				description: stepMessages.slice(0, 3).join('\n') || undefined,
				duration: 6000
			});
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
			{#if !usersViewActive}
				<Button type="submit" form="shelter-form" disabled={$submitting || isPending}>
					<Save class="h-4 w-4" />
					<span>{isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
				</Button>
			{/if}
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
					{#if !usersViewActive}
						<span class="text-[11px] font-semibold text-muted-foreground tabular-nums">
							{step + 1} / {steps.length}
						</span>
					{/if}
				</div>
				<ul class="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
					{#each steps as s, i (s.label)}
						{@const Icon = s.icon}
						{@const hasError = stepsWithErrorsSet.has(i)}
						{@const stepActive = !usersViewActive && step === i}
						<li class="shrink-0">
							<button
								type="button"
								onclick={() => selectStep(i)}
								aria-current={stepActive ? 'step' : undefined}
								class={[
									'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200',
									stepActive
										? hasError
											? 'bg-destructive text-white shadow-sm'
											: 'bg-primary text-white shadow-sm'
										: hasError
											? 'bg-destructive/10 text-destructive hover:-translate-y-px hover:bg-destructive/15'
											: 'text-muted-foreground hover:-translate-y-px hover:bg-muted/50 hover:text-foreground'
								]}
							>
								<Icon class="h-4 w-4 shrink-0" />
								<span class="min-w-0 flex-1 whitespace-nowrap md:whitespace-normal">{s.label}</span>
								{#if hasError}
									<AlertCircle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
									<span class="sr-only">มีข้อมูลที่ต้องแก้ไข</span>
								{/if}
							</button>
						</li>
					{/each}
					<li class="shrink-0">
						{#if isEdit}
							<button
								type="button"
								onclick={() => (usersViewActive = true)}
								aria-current={usersViewActive ? 'true' : undefined}
								class={[
									'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-200',
									usersViewActive
										? 'bg-primary text-white shadow-sm'
										: 'text-muted-foreground hover:-translate-y-px hover:bg-muted/50 hover:text-foreground'
								]}
							>
								<UserCog class="h-4 w-4 shrink-0" />
								<span class="min-w-0 flex-1 whitespace-nowrap md:whitespace-normal"
									>ผู้ใช้งานและสิทธิ์</span
								>
							</button>
						{:else}
							<button
								type="button"
								disabled
								title="บันทึกศูนย์ก่อนจึงเพิ่มผู้ใช้ได้"
								class="flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted-foreground/60"
							>
								<UserCog class="h-4 w-4 shrink-0" />
								<span class="min-w-0 flex-1 whitespace-nowrap md:whitespace-normal"
									>ผู้ใช้งานและสิทธิ์</span
								>
							</button>
							<p class="mt-1 px-3 text-[11px] text-muted-foreground">
								บันทึกศูนย์ก่อนจึงเพิ่มผู้ใช้ได้
							</p>
						{/if}
					</li>
				</ul>
			</nav>

			<!-- Step content -->
			<div class="min-w-0 flex-1">
				{#if usersViewActive && isEdit}
					<UserManagementPage lockedShelterCode={id} compact />
				{:else}
					{#if showValidationSummary && (stepsWithErrors.length > 0 || validationMessages.length > 0)}
						<div
							class="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
							role="alert"
						>
							<div class="flex items-start gap-2">
								<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
								<div class="min-w-0 flex-1 space-y-2">
									<p class="font-semibold">ยังมีข้อมูลที่ต้องกรอกหรือแก้ไข</p>
									{#if stepsWithErrors.length > 0}
										<ul class="flex flex-wrap gap-2">
											{#each stepsWithErrors as i (steps[i].label)}
												<li>
													<button
														type="button"
														onclick={() => selectStep(i)}
														class={[
															'rounded-md border px-2.5 py-1 text-xs font-medium transition',
															step === i
																? 'border-destructive bg-destructive text-white'
																: 'border-destructive/30 bg-background text-destructive hover:bg-destructive/10'
														]}
													>
														{steps[i].label}
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									{#if validationMessages.length > 0}
										<ul class="list-disc space-y-1 pl-5 text-destructive/90">
											{#each validationMessages as msg (msg)}
												<li>{msg}</li>
											{/each}
										</ul>
									{/if}
								</div>
							</div>
						</div>
					{/if}

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
				{/if}
			</div>
		</div>
	{/if}
</main>
