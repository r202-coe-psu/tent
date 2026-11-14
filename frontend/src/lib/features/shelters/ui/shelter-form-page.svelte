<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		useShelter,
		sheltersKeys,
		useCreateShelter,
		useUpdateShelter,
		needsShelterCloseModal,
		ShelterCloseDialog,
		type Shelter,
		type ShelterCloseResult,
		type SiteKind,
		BasicInfoSection,
		ZonesFacilitiesSection,
		FoodDistributionSection,
		StoragePointsSection,
		UtilitiesSection,
		RiskSection,
		AdmissionPolicySection,
		LuggagePolicySection,
		ParkingPolicySection,
		EMPTY_ADMISSION_POLICY,
		EMPTY_LUGGAGE_POLICY,
		EMPTY_PARKING_POLICY,
		DEFAULT_SHELTER_FEATURE_FLAGS
	} from '$lib/features/shelters';
	import type { SubStorageItem } from '../domain/schema';
	import { sameSubStorage } from '../domain/storage-points';
	import {
		editsSubStorage,
		formMetaAfterSave,
		shelterFormSchema,
		shelterPatchInput,
		withoutFormMeta,
		type ShelterForm
	} from '../domain/shelter-form';
	import { ServiceRequestError } from '$lib/api/service';
	import { collectErrorMessages, findInvalidSectionIds } from './shelter-form-validation';
	import ShelterFormStickyNav from './shelter-form-sticky-nav.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isShelterManager, isSystemAdmin } from '$lib/auth/roles';
	import { createScrollSpy } from '$lib/utils/scroll-spy';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Building2 from '@lucide/svelte/icons/building-2';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Warehouse from '@lucide/svelte/icons/warehouse';
	import Zap from '@lucide/svelte/icons/zap';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Car from '@lucide/svelte/icons/car';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import BackLink from '$lib/components/back-link.svelte';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Save from '@lucide/svelte/icons/save';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';

	let {
		id = '',
		isEdit,
		basePath,
		editBasePath,
		siteKind,
		stockedLotCount,
		stockReady,
		backLabel = 'กลับไปหน้าหลัก'
	}: {
		id?: string;
		isEdit: boolean;
		/** Cancel/back target. */
		basePath?: string;
		/** Visible name of `basePath`, shown on the back link. */
		backLabel?: string;
		/** Prefix of the `…/edit/{code}` route opened after create; defaults to `basePath`. */
		editBasePath?: string;
		siteKind?: SiteKind;
		/** Lots still holding stock at a storage point; blocks its delete button (CR-230 FR-11). */
		stockedLotCount?: (pointId: string) => number;
		/** False while the ledger behind `stockedLotCount` is still loading. */
		stockReady?: boolean;
	} = $props();

	const resolvedBasePath = $derived(basePath ?? resolve('/portal'));
	const resolvedEditBasePath = $derived(editBasePath ?? resolvedBasePath);

	function handleCancelOrBack(e?: MouseEvent) {
		if (e) e.preventDefault();
		if (typeof window !== 'undefined' && window.history.length > 1) {
			window.history.back();
		} else {
			goto(resolvedBasePath);
		}
	}

	const shelterQuery = useShelter(() => id);
	const createMutation = useCreateShelter();
	const updateMutation = useUpdateShelter();
	const queryClient = useQueryClient();

	// CR-219 FR-15: saving a not-yet-closed shelter as `closed` goes through the confirm modal
	// first; the form data waits here until the close request has finished.
	let closeDialogOpen = $state(false);
	let pendingCloseData = $state.raw<ShelterForm | null>(null);
	const storedStatus = $derived(shelterQuery.data?.operation_status);

	// CR-219 FR-23: only SA / this shelter's manager may pick "closed" (create mode is unchanged).
	const canCloseShelter = $derived.by(() => {
		if (!isEdit) return true;
		const roles = authStore.user?.roles ?? [];
		return isSystemAdmin(roles) || isShelterManager(roles, id);
	});

	function revertOperationStatus() {
		if (storedStatus) $formData.operation_status = storedStatus;
	}

	function handleCloseCancel() {
		// FR-18: nothing was sent; put the select back to the stored value.
		pendingCloseData = null;
		revertOperationStatus();
	}

	type ShelterDoc = NonNullable<typeof shelterQuery.data>;

	/**
	 * The form data for a stored shelter doc, including the `_rev` and points it was loaded from
	 * (CR-230 A1). Keeping them in the form data means they are always replaced together with the
	 * fields, whoever writes the fields.
	 */
	function formValuesFromDoc(d: ShelterDoc): ShelterForm {
		return {
			name: d.name,
			site_kind: d.site_kind,
			operation_status: d.operation_status,
			is_external: d.is_external === true,
			external_url: d.external_url ?? null,
			shelter_type: d.shelter_type ?? null,
			floor_count: d.floor_count ?? null,
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
			capacity: d.is_external === true && !d.capacity ? undefined : d.capacity,
			area_m2: d.area_m2 ?? null,
			area_type: (d.area_type ?? null) as Shelter['area_type'],
			facilities: d.facilities ?? {},
			common_areas: d.common_areas ?? { sub_storage: [] },
			utilities: d.utilities ?? { communications: [] },
			risk: d.risk ?? {},
			zones: d.zones ?? [],
			food_distribution_points: d.food_distribution_points ?? [],
			admission_policy: d.admission_policy ?? { ...EMPTY_ADMISSION_POLICY },
			luggage_policy: d.luggage_policy ?? { ...EMPTY_LUGGAGE_POLICY },
			parking_policy: d.parking_policy ?? { ...EMPTY_PARKING_POLICY },
			feature_flags: {
				...DEFAULT_SHELTER_FEATURE_FLAGS,
				...(d.feature_flags ?? {})
			},
			_rev: d._rev,
			// A copy: an in-place edit of the form's points must not also change the snapshot.
			_loaded_sub_storage: $state.snapshot(d.common_areas?.sub_storage ?? [])
		} as ShelterForm;
	}

	const SHELTER_CONFLICT_MESSAGE =
		'ข้อมูลศูนย์ถูกแก้ไขโดยผู้อื่น โหลดข้อมูลล่าสุดให้แล้ว กรุณาแก้ไขซ้ำอีกครั้ง';

	/**
	 * Replace the form with `doc`. `untaint-all` makes the doc the clean baseline, so `isTainted`
	 * only ever means "the user edited something".
	 */
	function seedForm(doc: ShelterDoc) {
		formData.set(formValuesFromDoc(doc), { taint: 'untaint-all' });
	}

	/** Replace the form with the latest doc in the cache (the 409 path; the hook refetched it first). */
	function reloadFromLatest() {
		const latest = queryClient.getQueryData<ShelterDoc>(sheltersKeys.detail(id));
		if (latest) seedForm(latest);
	}

	/**
	 * Edit save. `rev` defaults to the one the form data was loaded with. The hook's `onError` has
	 * awaited the refetch before this call's `onError` runs, and superforms' own write-back of the
	 * submitted data happened when `onUpdate` returned, so a 409 reload is the last write.
	 * On success only `_rev` and the loaded points move on (to what this save wrote), so the next
	 * save does not 409 against our own write; typed-since fields stay. Skipped when the form was
	 * reseeded meanwhile: its `_rev` is then not the one this data was loaded with.
	 */
	function saveEdit(data: ShelterForm, rev = data._rev) {
		updateMutation.mutate(
			{ code: id, input: shelterPatchInput(data), rev },
			{
				onSuccess: (result) => {
					if ($formData._rev !== data._rev) return;
					formData.update((d) => ({ ...d, ...formMetaAfterSave(data, result.rev) }), {
						taint: false
					});
				},
				onError: (err) => {
					if (err instanceof ServiceRequestError && err.status === 409) reloadFromLatest();
				}
			}
		);
	}

	async function handleCloseFinish(result: ShelterCloseResult) {
		const data = pendingCloseData;
		pendingCloseData = null;
		if (!result.closed || !data) {
			revertOperationStatus();
			return;
		}
		// Registry is closed now, so the normal save (other edited fields) passes the PATCH guard.
		// The close route rewrote the doc, so this save needs the fresh `_rev`. Points edited in this
		// form must not land over points someone else changed meanwhile: `data` carries the points
		// it was loaded with, so compare those with the fresh doc.
		const fresh = await shelterQuery.refetch();
		if (
			editsSubStorage(data) &&
			fresh.data &&
			!sameSubStorage(
				fresh.data.common_areas?.sub_storage,
				data._loaded_sub_storage as SubStorageItem[] | undefined
			)
		) {
			toast.error(SHELTER_CONFLICT_MESSAGE);
			reloadFromLatest();
			return;
		}
		saveEdit(data, fresh.data?._rev ?? data._rev);
	}

	const allSections = [
		{ id: 'basic-info', label: 'ข้อมูลพื้นฐานและที่ตั้ง', icon: MapPin },
		{ id: 'capacity', label: 'ความจุ โซน และสิ่งอำนวยความสะดวก', icon: Building2 },
		{ id: 'food-distribution', label: 'จุดแจกอาหาร', icon: UtensilsCrossed },
		{ id: 'storage-points', label: 'จุดเก็บของ', icon: Warehouse },
		{ id: 'utilities', label: 'สถานะสาธารณูปโภคพื้นฐาน', icon: Zap },
		{ id: 'risk', label: 'ประเมินความเสี่ยงและโครงสร้าง', icon: ShieldAlert },
		{ id: 'admission-policy', label: 'นโยบายการรับผู้อพยพ', icon: PawPrint },
		{ id: 'luggage-policy', label: 'นโยบายทรัพย์สิน / สัมภาระ', icon: Briefcase },
		{ id: 'parking-policy', label: 'นโยบายยานพาหนะ', icon: Car }
	];

	let activeSection = $state('basic-info');
	let showValidationSummary = $state(false);

	const scrollSpy = createScrollSpy({
		sectionIds: () => sections.map((s) => s.id),
		prefix: '',
		stickyVar: '--shelter-form-sticky-top',
		onActiveChange: (id) => {
			activeSection = id;
		}
	});

	function navigateToSection(id: string) {
		activeSection = id;
		scrollSpy.pause();
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	const form = superForm(defaults(zod4(shelterFormSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4(shelterFormSchema),
		resetForm: false,
		// SPA form with no server load to refresh; `invalidateAll` would only delay superforms'
		// write-back of the submitted data, which could then land after a 409 reload.
		invalidateAll: false,
		onUpdate: async ({ form: validated, cancel }) => {
			if (!validated.valid) {
				showValidationSummary = true;
				await revealValidationIssues(validated.errors);
				return;
			}

			showValidationSummary = false;
			const data = validated.data;

			if (isEdit && needsShelterCloseModal(storedStatus, data.operation_status)) {
				pendingCloseData = data;
				closeDialogOpen = true;
				// Nothing is saved yet: a result superforms applies would untaint the form, and the
				// seed effect would then replace the user's edits with a newer doc before the modal
				// even opens. Cancelled, the form keeps its data and its taint for the whole flow.
				cancel();
				return;
			}

			if (isEdit) {
				// Stay on the edit form; toasts come from useUpdateShelter.
				saveEdit(data);
			} else {
				createMutation.mutate(withoutFormMeta(data), {
					onSuccess: (result) => {
						// Deep-link to edit so further saves are updates and users unlock.
						// Success toast comes from useCreateShelter.
						if (result?.code) {
							goto(`${resolvedEditBasePath}/edit/${encodeURIComponent(result.code)}`);
						}
					}
				});
			}
		}
	});

	const { form: formData, submitting, enhance, errors, tainted, isTainted } = form;

	// CR-252 FR-19: an external shelter keeps only basic info — the other sections are not rendered.
	const isExternal = $derived($formData.is_external === true);

	const sections = $derived(isExternal ? allSections.slice(0, 1) : allSections);

	const invalidSectionIds = $derived.by(() =>
		showValidationSummary ? findInvalidSectionIds($errors) : []
	);
	const sectionsWithErrorsSet = $derived(new Set(invalidSectionIds));

	const validationMessages = $derived.by(() => {
		if (!showValidationSummary) return [] as string[];
		return collectErrorMessages($errors);
	});

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
	if (!$formData.feature_flags) $formData.feature_flags = { ...DEFAULT_SHELTER_FEATURE_FLAGS };
	if (!$formData.food_distribution_points) $formData.food_distribution_points = [];

	// `.pre` so a kind carried in from the list filter (FR-11) lands before the master default seeds.
	$effect.pre(() => {
		if (!isEdit && siteKind && !$formData.site_kind) $formData.site_kind = siteKind;
	});

	// The stored doc moved past the one the form was loaded from (first load, or someone saved).
	const docIsNewer = $derived(!!shelterQuery.data && shelterQuery.data._rev !== $formData._rev);
	// Before the first load the form only holds init defaults (which taint it), so there is
	// nothing of the user's to protect yet.
	const hasUnsavedEdits = $derived($formData._rev !== undefined && isTainted($tainted));
	// Unsaved edits are never replaced: they get a notice instead.
	const showNewerDocNotice = $derived(docIsNewer && hasUnsavedEdits);

	$effect(() => {
		if (shelterQuery.data && docIsNewer && !hasUnsavedEdits) seedForm(shelterQuery.data);
	});

	const isPending = $derived(isEdit ? updateMutation.isPending : createMutation.isPending);
	const isLoading = $derived(isEdit ? shelterQuery.isLoading : false);
	const isError = $derived(isEdit ? shelterQuery.isError : false);
	const errorMessage = $derived(isEdit ? (shelterQuery.error?.message ?? '') : '');

	async function revealValidationIssues(formErrors: unknown) {
		const invalidIds = findInvalidSectionIds(formErrors);
		const messages = collectErrorMessages(formErrors);

		if (invalidIds.length > 0) {
			navigateToSection(invalidIds[0]!);
			await tick();
		}

		const firstInvalid = document.querySelector<HTMLElement>('#shelter-form [aria-invalid="true"]');
		firstInvalid?.focus();
		firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });

		const categoryLabels = invalidIds
			.map((id) => sections.find((s) => s.id === id)?.label)
			.filter(Boolean);
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

	const statusBadgeConfig = $derived.by(() => {
		const status = $formData.operation_status;
		switch (status) {
			case 'active':
				return {
					label: 'เปิดรับผู้อพยพ (Active)',
					classes: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
					dot: 'bg-emerald-500'
				};
			case 'full_capacity':
				return {
					label: 'เต็มความจุ (Full)',
					classes: 'border border-amber-200 bg-amber-50 text-amber-900',
					dot: 'bg-amber-500'
				};
			case 'cancelled':
				return {
					label: 'ยกเลิกศูนย์ (Cancelled)',
					classes: 'border border-red-200 bg-red-50 text-red-900',
					dot: 'bg-red-500'
				};
			case 'closed':
				return {
					label: 'ปิดศูนย์ (Closed)',
					classes: 'border border-slate-200 bg-slate-100 text-slate-700',
					dot: 'bg-slate-400'
				};
			case 'unknown':
				return {
					label: 'ไม่ทราบสถานะ (Unknown)',
					classes: 'border border-slate-300 bg-slate-100 text-slate-700',
					dot: 'bg-slate-400'
				};
			case 'standby':
			default:
				return {
					label: 'กำลังเตรียมการ (Standby)',
					classes: 'border border-sky-200 bg-sky-50 text-sky-900',
					dot: 'bg-sky-500'
				};
		}
	});

	// Guard native implicit submit: Enter in a text input must not save/redirect.
	// Enter inside a <textarea> is left alone.
	function onFormKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (event.key === 'Enter' && target?.tagName !== 'TEXTAREA') {
			event.preventDefault();
		}
	}
</script>

<main class="min-h-screen max-w-full overflow-x-clip bg-[#F8FAFC] text-slate-800 antialiased">
	<!-- Civic Light Page Header -->
	<header
		class="relative z-20 border-b border-slate-200 bg-white/95 shadow-xs backdrop-blur-sm sm:sticky sm:top-[var(--bo-sticky-top)]"
	>
		<div class="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8">
			<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<!-- Mobile Rows 1 & 2 / Desktop Left Column -->
				<div class="min-w-0">
					<BackLink href={resolvedBasePath} label={backLabel} class="mb-1 -ml-3" />
					<div class="min-w-0 flex-1 space-y-0.5">
						<!-- Row 1 on mobile: Title + Badge -->
						<div class="flex flex-wrap items-center gap-2">
							<h1 class="text-lg leading-snug font-bold tracking-tight text-[#0A2647] sm:text-2xl">
								{isEdit ? $formData.name || 'แก้ไขข้อมูลศูนย์พักพิง' : 'สร้างศูนย์พักพิงใหม่'}
							</h1>
							{#if isEdit}
								<span
									class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold {statusBadgeConfig.classes}"
								>
									<span class="h-1.5 w-1.5 rounded-full {statusBadgeConfig.dot}"></span>
									<span>{statusBadgeConfig.label}</span>
								</span>
							{/if}
						</div>
						<!-- Row 2 on mobile: Subtitle -->
						<p class="text-xs leading-relaxed text-slate-500">
							{isEdit
								? `รหัสศูนย์: ${id} • จัดการข้อมูลและนโยบายการดำเนินงานศูนย์พักพิง`
								: 'กรอกข้อมูลศูนย์พักพิงและกำหนดนโยบายเพื่อขึ้นทะเบียนในระบบ'}
						</p>
					</div>
				</div>

				<!-- Mobile Row 3 / Desktop Right Column — never shrinks past its buttons (the title wraps
				     instead), and wraps on narrow widths, so บันทึกข้อมูล is never pushed off-screen. -->
				<div
					class="flex flex-wrap items-center gap-2.5 pt-0.5 sm:shrink-0 sm:flex-nowrap sm:justify-end sm:pt-0"
				>
					{#if isEdit && id}
						<a
							href={resolve(
								`/back-office/shelters/readiness/${encodeURIComponent(id)}` as '/back-office/shelters'
							)}
							class="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-center text-sm font-semibold text-sky-900 shadow-2xs transition hover:bg-sky-100 sm:flex-none"
						>
							<ClipboardCheck class="h-4 w-4 text-sky-700" />
							<span>แบบประเมินความพร้อม (Readiness)</span>
						</a>
					{/if}
					<a
						href={resolvedBasePath}
						onclick={handleCancelOrBack}
						class="flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-center text-sm font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 sm:flex-none"
					>
						ยกเลิก
					</a>
					<Button
						type="submit"
						form="shelter-form"
						disabled={$submitting || isPending}
						class="flex-1 gap-2 rounded-lg bg-[#0A2647] px-4 py-2 text-sm font-semibold text-white shadow-2xs transition hover:bg-[#051930] sm:flex-none"
					>
						{#if isPending}
							<Loader2 class="h-4 w-4 animate-spin" />
							<span>กำลังบันทึก...</span>
						{:else}
							<Save class="h-4 w-4" />
							<span>บันทึกข้อมูล</span>
						{/if}
					</Button>
				</div>
			</div>
		</div>
	</header>

	{#if isLoading}
		<div class="flex items-center justify-center py-24 text-slate-500">
			<Loader2 class="mr-2 h-5 w-5 animate-spin text-[#0284C7]" />
			<span>กำลังโหลดข้อมูลศูนย์พักพิง...</span>
		</div>
	{:else if isError}
		<div
			class="mx-auto my-16 max-w-md space-y-3 rounded-2xl border border-red-200 bg-white p-8 text-center shadow-xs"
		>
			<AlertCircle class="mx-auto h-8 w-8 text-red-600" />
			<h2 class="text-base font-bold text-slate-900">เกิดข้อผิดพลาดในการดึงข้อมูล</h2>
			<p class="text-xs text-slate-500">{errorMessage}</p>
			<a
				href={resolvedBasePath}
				class="inline-block rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
			>
				{backLabel}
			</a>
		</div>
	{:else}
		<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
			{#if showNewerDocNotice}
				<Alert.Root class="mb-4 border-sky-200 bg-sky-50 text-sky-900" role="status">
					<RefreshCw />
					<Alert.Title>มีข้อมูลใหม่</Alert.Title>
					<Alert.Description class="text-sky-900/80">
						ข้อมูลศูนย์นี้ถูกแก้ไขโดยผู้อื่น ข้อมูลที่คุณแก้ยังไม่ถูกแทนที่
						โหลดข้อมูลล่าสุดจะทำให้การแก้ไขที่ยังไม่ได้บันทึกหายไป
					</Alert.Description>
					<Alert.Action>
						<Button type="button" size="sm" variant="outline" onclick={reloadFromLatest}>
							โหลดข้อมูลล่าสุด
						</Button>
					</Alert.Action>
				</Alert.Root>
			{/if}
			<div class="flex flex-col gap-6 pb-28 md:flex-row">
				<!-- Desktop sticky section nav -->
				<nav
					class="hidden shrink-0 md:sticky md:top-[calc(var(--shelter-form-sticky-top)+1rem)] md:block md:max-h-[calc(100dvh-var(--shelter-form-sticky-top)-2rem)] md:w-64 md:self-start md:overflow-y-auto md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-xs"
				>
					<div class="mb-2 px-2.5 pt-1">
						<p class="text-xs font-bold tracking-wider text-slate-400 uppercase">สารบัญหมวดหมู่</p>
					</div>
					<ul class="flex flex-col gap-1.5">
						{#each sections as s, idx (s.id)}
							{@const hasError = sectionsWithErrorsSet.has(s.id)}
							{@const sectionActive = activeSection === s.id}
							<li>
								<button
									type="button"
									onclick={() => navigateToSection(s.id)}
									aria-current={sectionActive ? 'true' : undefined}
									class={[
										'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all duration-200',
										sectionActive
											? hasError
												? 'border-red-200 bg-red-50 font-semibold text-red-900 shadow-2xs'
												: 'border-sky-200 bg-sky-50/80 font-semibold text-[#0A2647] shadow-2xs'
											: hasError
												? 'border-transparent bg-red-50/50 text-red-700 hover:bg-red-50'
												: 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
									]}
								>
									<span
										class={[
											'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-2xs font-bold tabular-nums',
											sectionActive ? 'bg-[#0A2647] text-white' : 'bg-slate-100 text-slate-500'
										]}
									>
										{idx + 1}
									</span>
									<span class="min-w-0 flex-1 truncate">{s.label}</span>
									{#if hasError}
										<AlertCircle class="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
										<span class="sr-only">มีข้อมูลที่ต้องแก้ไข</span>
									{/if}
								</button>
							</li>
						{/each}
					</ul>
				</nav>

				<!-- Form content -->
				<div class="min-w-0 flex-1">
					{#if showValidationSummary && (invalidSectionIds.length > 0 || validationMessages.length > 0)}
						<div
							class="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
							role="alert"
						>
							<div class="flex items-start gap-2">
								<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
								<div class="min-w-0 flex-1 space-y-2">
									<p class="font-semibold">ยังมีข้อมูลที่ต้องกรอกหรือแก้ไข</p>
									{#if invalidSectionIds.length > 0}
										<ul class="flex flex-wrap gap-2">
											{#each invalidSectionIds as sectionId (sectionId)}
												{@const label =
													sections.find((s) => s.id === sectionId)?.label ?? sectionId}
												<li>
													<button
														type="button"
														onclick={() => navigateToSection(sectionId)}
														class={[
															'rounded-md border px-2.5 py-1 text-xs font-medium transition',
															activeSection === sectionId
																? 'border-destructive bg-destructive text-white'
																: 'border-destructive/30 bg-background text-destructive hover:bg-destructive/10'
														]}
													>
														{label}
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
					<!-- keydown guards native implicit submit (Enter) except inside textarea -->
					<form
						id="shelter-form"
						method="POST"
						use:enhance
						onkeydown={onFormKeydown}
						{@attach scrollSpy}
					>
						<BasicInfoSection
							{form}
							{formData}
							canClose={canCloseShelter}
							storedStatus={isEdit ? storedStatus : undefined}
							isSystemAdmin={isSystemAdmin(authStore.user?.roles ?? [])}
							{isEdit}
						/>
						{#if !isExternal}
							<ZonesFacilitiesSection {form} {formData} shelterCode={id} />
							<FoodDistributionSection {form} {formData} />
							<StoragePointsSection {form} {formData} {stockedLotCount} {stockReady} />
							<UtilitiesSection {form} {formData} />
							<RiskSection {form} {formData} />
							<AdmissionPolicySection {formData} />
							<LuggagePolicySection {formData} />
							<ParkingPolicySection {formData} />
						{/if}
					</form>
				</div>
			</div>
		</div>

		{#if isEdit && shelterQuery.data}
			<ShelterCloseDialog
				bind:open={closeDialogOpen}
				code={id}
				name={shelterQuery.data.name}
				oncancel={handleCloseCancel}
				onfinish={handleCloseFinish}
			/>
		{/if}

		<ShelterFormStickyNav
			{sections}
			{activeSection}
			sectionsWithErrors={sectionsWithErrorsSet}
			ariaLabel="นำทางหมวดหมู่ฟอร์มศูนย์พักพิง"
			onNavigate={navigateToSection}
			onCancel={handleCancelOrBack}
			savePending={isPending}
			saveDisabled={$submitting || isPending}
		/>
	{/if}
</main>
