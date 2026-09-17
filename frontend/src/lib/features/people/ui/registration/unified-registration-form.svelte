<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import Users from '@lucide/svelte/icons/users';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { onMount, tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { ZodIssue } from 'zod';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import HouseholdAddressFields from '../forms/household-address-fields.svelte';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';
	import UnifiedRegistrationStickyNav from './unified-registration-sticky-nav.svelte';
	import UnifiedRegistrationSubmitBar from './unified-registration-submit-bar.svelte';
	import UnifiedRegistrationPetsSection from './unified-registration-pets-section.svelte';
	import UnifiedRegistrationVehiclesSection from './unified-registration-vehicles-section.svelte';
	import UnifiedRegistrationMembersSection from './unified-registration-members-section.svelte';
	import { readRegistrationStickyTopPx } from './registration-sticky-offset';
	import {
		applyIntersectionEntries,
		isScrollNearEnd,
		pickActiveSectionId
	} from './registration-scroll-spy';
	import {
		parseInitialPets,
		syncPetsToHousehold,
		type PetCardItem
	} from './unified-registration-pets';
	import {
		blankUnifiedMember,
		unifiedRegistrationInputSchema,
		type MemberPhotoUploadMode,
		type UnifiedMemberWithMeta,
		type UnifiedRegistrationChannel,
		type UnifiedRegistrationInput,
		type UnifiedHouseholdInput
	} from '../../domain/unified-registration';
	import type { HouseholdVehicle, PetGroup } from '../../domain/people';

	type FormSectionId = 'address' | 'pets' | 'vehicles' | 'members';

	let {
		channel = 'onsite',
		mode = 'create',
		initialHousehold = null,
		initialMembers = null,
		pending = false,
		submitDisabled = false,
		submitLabel,
		submitAlign = 'right',
		stickyTopOffset,
		includeVehiclesAssets,
		enableUnassignedPhoto = false,
		shelterCode = '',
		onsubmit,
		onDirtyChange,
		children
	}: {
		channel?: UnifiedRegistrationChannel;
		mode?: 'create' | 'report-in';
		initialHousehold?: UnifiedHouseholdInput | null;
		initialMembers?: UnifiedMemberWithMeta[] | null;
		pending?: boolean;
		/** Disable the confirm button without locking fields or showing submit spinner. */
		submitDisabled?: boolean;
		submitLabel?: string;
		submitAlign?: 'right' | 'center';
		stickyTopOffset?: string;
		includeVehiclesAssets?: boolean;
		enableUnassignedPhoto?: boolean;
		shelterCode?: string;
		onsubmit: (
			input: UnifiedRegistrationInput,
			meta?: { reportingInMembers: UnifiedMemberWithMeta[]; allMembers: UnifiedMemberWithMeta[] }
		) => Promise<void> | void;
		onDirtyChange?: (dirty: boolean) => void;
		children?: import('svelte').Snippet<[{ household: UnifiedRegistrationInput['household'] }]>;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const showVehiclesAssets = $derived(includeVehiclesAssets ?? channel === 'onsite');
	const formStickyStyle = $derived(
		stickyTopOffset ? `--registration-sticky-top: ${stickyTopOffset}` : undefined
	);
	const shelterPhotoEnabled = $derived(
		channel === 'public' && !enableUnassignedPhoto && Boolean(shelterCode.trim())
	);
	/** Onsite / public-shelter → Couch image; public unassigned → GridFS. */
	const showPetPhotoUpload = $derived(
		channel === 'onsite' || enableUnassignedPhoto || shelterPhotoEnabled
	);
	const memberPhotoUpload = $derived.by((): MemberPhotoUploadMode => {
		if (channel === 'onsite') return 'onsite-couch';
		if (enableUnassignedPhoto) return 'unassigned-gridfs';
		if (shelterPhotoEnabled) return 'shelter-couch';
		return 'none';
	});

	function buildInitialHousehold(): UnifiedRegistrationInput['household'] {
		if (initialHousehold) {
			return {
				housing_type: initialHousehold.housing_type ?? 'owned_house',
				residence_landmark: initialHousehold.residence_landmark ?? null,
				address_no: initialHousehold.address_no ?? '',
				village_no: initialHousehold.village_no ?? '',
				subdistrict: initialHousehold.subdistrict ?? '',
				district: initialHousehold.district ?? '',
				province: initialHousehold.province ?? '',
				postal_code: initialHousehold.postal_code ?? '',
				pets: (initialHousehold.pets ?? []) as PetGroup[],
				vehicles: (initialHousehold.vehicles ?? []) as HouseholdVehicle[],
				assets: initialHousehold.assets ?? null
			};
		}
		return {
			housing_type: 'owned_house',
			residence_landmark: null,
			address_no: '',
			village_no: '',
			subdistrict: '',
			district: '',
			province: '',
			postal_code: '',
			pets: [] as PetGroup[],
			vehicles: [] as HouseholdVehicle[],
			assets: null
		};
	}

	function buildInitialMembers(): UnifiedMemberWithMeta[] {
		if (initialMembers && initialMembers.length > 0) {
			return initialMembers.map((m) => ({
				...m,
				reporting_in: m.reporting_in ?? (m.stay_status === 'pre_registered' || !m._id)
			}));
		}
		return [blankUnifiedMember()];
	}

	let members = $state<UnifiedMemberWithMeta[]>(untrack(() => buildInitialMembers()));
	let household = $state<UnifiedRegistrationInput['household']>(
		untrack(() => buildInitialHousehold())
	);
	let assetDescription = $state(untrack(() => initialHousehold?.assets?.description ?? ''));
	let formError = $state<string | null>(null);
	let validationMessages = $state<string[]>([]);
	let memberFieldErrors = $state<Record<number, Record<string, string>>>({});
	let formRootEl = $state<HTMLFormElement | null>(null);
	let touched = $state(false);
	let activeSection = $state<FormSectionId>('address');
	let scrollSpyPaused = $state(false);

	let petItems = $state<PetCardItem[]>(
		untrack(() => parseInitialPets(household.pets as PetGroup[]).items)
	);

	$effect(() => {
		if (initialMembers && !touched) {
			members = buildInitialMembers();
		}
	});

	$effect(() => {
		if (initialHousehold && !touched) {
			household = buildInitialHousehold();
			assetDescription = initialHousehold.assets?.description ?? '';
			petItems = parseInitialPets((initialHousehold.pets ?? []) as PetGroup[]).items;
		}
	});

	const formSectionNav = $derived.by(() => {
		const items: { id: FormSectionId; label: string; icon: typeof Home }[] = [
			{ id: 'address', label: t.sectionAddress, icon: Home },
			{ id: 'pets', label: t.sectionPets, icon: PawPrint }
		];
		if (showVehiclesAssets) {
			items.push({ id: 'vehicles', label: t.sectionVehicles, icon: Package });
		}
		items.push({ id: 'members', label: t.sectionMembers, icon: Users });
		return items;
	});

	const membersSectionDesc = $derived(
		mode === 'report-in'
			? 'ตรวจสอบข้อมูลสมาชิก และติ๊กเลือกผู้ที่มารายงานตัวในรอบนี้ (สามารถกดเพิ่มสมาชิกใหม่ที่เดินทางมาด้วยกันได้)'
			: showVehiclesAssets
				? `${t.sectionMembersDesc} ${t.sectionMembersDescOnsite}`
				: t.sectionMembersDesc
	);

	const effectiveSubmitLabel = $derived(
		submitLabel ??
			(mode === 'report-in'
				? 'ยืนยันรายงานตัวและพิมพ์บัตร'
				: channel === 'public'
					? t.submitConfirm
					: t.submitOnsite)
	);

	onMount(() => {
		onDirtyChange?.(false);
	});

	function findScrollParent(element: Element): Element | null {
		let parent = element.parentElement;
		while (parent) {
			const { overflowY } = getComputedStyle(parent);
			if (overflowY === 'auto' || overflowY === 'scroll') return parent;
			parent = parent.parentElement;
		}
		return null;
	}

	function createScrollSpy(): import('svelte/attachments').Attachment {
		return (node) => {
			const sectionNodes = () =>
				formSectionNav
					.map((s) => document.getElementById(`unified-${s.id}`))
					.filter((el): el is HTMLElement => el instanceof HTMLElement);

			const scrollRoot = findScrollParent(node);
			const stickyTopPx = readRegistrationStickyTopPx(node);
			const ratiosById = new Map<string, number>();

			const syncActive = () => {
				if (scrollSpyPaused) return;
				const sectionIds = formSectionNav.map((s) => s.id);
				const next = pickActiveSectionId(sectionIds, ratiosById, {
					atScrollEnd: isScrollNearEnd(scrollRoot)
				});
				if (next && formSectionNav.some((s) => s.id === next)) {
					activeSection = next as FormSectionId;
				}
			};

			const observer = new IntersectionObserver(
				(entries) => {
					applyIntersectionEntries(
						ratiosById,
						entries.flatMap((entry) => {
							const target = entry.target;
							if (!(target instanceof HTMLElement) || !target.id.startsWith('unified-')) {
								return [];
							}
							return [
								{
									id: target.id.replace('unified-', ''),
									isIntersecting: entry.isIntersecting,
									intersectionRatio: entry.intersectionRatio
								}
							];
						})
					);
					syncActive();
				},
				{
					root: scrollRoot,
					rootMargin: `-${Math.round(stickyTopPx + 8)}px 0px -55% 0px`,
					threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
				}
			);

			for (const el of sectionNodes()) observer.observe(el);
			const scrollTarget: Element | Window = scrollRoot ?? window;
			scrollTarget.addEventListener('scroll', syncActive, { passive: true });
			return () => {
				observer.disconnect();
				scrollTarget.removeEventListener('scroll', syncActive);
			};
		};
	}

	function scrollToSection(sectionId: FormSectionId) {
		scrollSpyPaused = true;
		activeSection = sectionId;
		document.getElementById(`unified-${sectionId}`)?.scrollIntoView({
			behavior: 'smooth',
			block: 'start'
		});
		window.setTimeout(() => {
			scrollSpyPaused = false;
		}, 700);
	}

	function markDirty() {
		if (touched) return;
		touched = true;
		onDirtyChange?.(true);
	}

	function clearDirty() {
		if (!touched) return;
		touched = false;
		onDirtyChange?.(false);
	}

	function onPetsSynced() {
		household.pets = syncPetsToHousehold(petItems);
		markDirty();
	}

	function mapZodIssues(issues: ZodIssue[]): {
		messages: string[];
		memberErrors: Record<number, Record<string, string>>;
	} {
		const messages: string[] = [];
		const memberErrors: Record<number, Record<string, string>> = {};
		for (const issue of issues) {
			messages.push(issue.message);
			const [root, idx, field] = issue.path;
			if (root === 'members' && typeof idx === 'number' && typeof field === 'string') {
				memberErrors[idx] ??= {};
				if (!memberErrors[idx][field]) memberErrors[idx][field] = issue.message;
			}
		}
		return {
			messages: [...new Set(messages.filter(Boolean))],
			memberErrors
		};
	}

	async function revealValidation(message: string, messages: string[] = []) {
		formError = message;
		validationMessages = messages.length > 0 ? messages : [message];
		toast.error(message, {
			description: validationMessages.slice(0, 3).join('\n'),
			duration: 6000
		});
		await tick();
		formRootEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function jumpToFirstError() {
		const firstInvalid = formRootEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
		if (firstInvalid) {
			firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
			requestAnimationFrame(() => firstInvalid.focus({ preventScroll: true }));
			return;
		}
		scrollToSection('members');
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (pending) return;

		for (const p of petItems) {
			if (p.species === 'other' && !p.customSpecies.trim()) {
				memberFieldErrors = {};
				await revealValidation(t.petOtherSpeciesRequired);
				scrollToSection('pets');
				return;
			}
		}
		household.pets = syncPetsToHousehold(petItems);

		const payload: UnifiedRegistrationInput = {
			members,
			household: {
				...household,
				vehicles: showVehiclesAssets ? (household.vehicles ?? []) : [],
				assets:
					showVehiclesAssets && assetDescription.trim()
						? { description: assetDescription.trim(), image_url: null }
						: null
			}
		};

		const result = unifiedRegistrationInputSchema.safeParse(payload);
		if (!result.success) {
			const mapped = mapZodIssues(result.error.issues);
			memberFieldErrors = mapped.memberErrors;
			const first = mapped.messages[0] ?? t.validationError;
			await revealValidation(first, mapped.messages);
			return;
		}

		if (channel === 'public') {
			const headPhone = members[0]?.phone?.trim();
			if (!headPhone || !/^0\d{8,9}$/.test(headPhone.replace(/[-\s]/g, ''))) {
				memberFieldErrors = { 0: { phone: t.headPhoneRequired } };
				await revealValidation(t.headPhoneRequired);
				return;
			}
		}

		if (mode === 'report-in') {
			const reportingCount = members.filter((m) => m.reporting_in).length;
			if (reportingCount === 0) {
				memberFieldErrors = {};
				await revealValidation('กรุณาเลือกสมาชิกอย่างน้อย 1 คนที่มารายงานตัวในรอบนี้');
				scrollToSection('members');
				return;
			}
		}

		formError = null;
		validationMessages = [];
		memberFieldErrors = {};
		try {
			await onsubmit(result.data as UnifiedRegistrationInput, {
				reportingInMembers: members.filter((m) => m.reporting_in),
				allMembers: members
			});
			clearDirty();
		} catch {
			// Caller surfaces save errors.
		}
	}
</script>

<form
	class="space-y-6"
	style={formStickyStyle}
	bind:this={formRootEl}
	onsubmit={handleSubmit}
	oninput={markDirty}
	{@attach createScrollSpy()}
>
	{#if formError}
		<Alert.Root variant="destructive" class="border-destructive/40 bg-destructive/5" role="alert">
			<CircleAlert class="size-4" />
			<Alert.Title class="font-semibold">{t.validationSummaryTitle}</Alert.Title>
			<Alert.Description>
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each validationMessages as msg (msg)}
						<li>{msg}</li>
					{/each}
				</ul>
				<Button
					type="button"
					variant="outline"
					size="sm"
					class="mt-3 h-9 border-destructive/40 text-destructive hover:bg-destructive/10"
					onclick={jumpToFirstError}
				>
					{t.jumpToFirstError}
				</Button>
			</Alert.Description>
		</Alert.Root>
	{/if}

	<!-- ── Section 1: Address ─────────────────────────────────── -->
	<UnifiedRegistrationSection
		id="unified-address"
		title={t.sectionAddress}
		description={t.sectionAddressDesc}
		icon={Home}
	>
		<HouseholdAddressFields
			bind:housing_type={household.housing_type}
			bind:residence_landmark={
				() => household.residence_landmark ?? '',
				(v) => {
					household.residence_landmark = v || null;
				}
			}
			bind:address_no={
				() => household.address_no ?? '',
				(v) => {
					household.address_no = v;
				}
			}
			bind:village_no={
				() => household.village_no ?? '',
				(v) => {
					household.village_no = v;
				}
			}
			bind:subdistrict={
				() => household.subdistrict ?? '',
				(v) => {
					household.subdistrict = v;
				}
			}
			bind:district={
				() => household.district ?? '',
				(v) => {
					household.district = v;
				}
			}
			bind:province={
				() => household.province ?? '',
				(v) => {
					household.province = v;
				}
			}
			bind:postal_code={
				() => household.postal_code ?? '',
				(v) => {
					household.postal_code = v;
				}
			}
			loadMasterHousingTypes={channel !== 'public'}
			required={true}
			disabled={pending}
		/>
	</UnifiedRegistrationSection>

	<!-- ── Section 2: Pets ────────────────────────────────────────── -->
	<UnifiedRegistrationPetsSection
		bind:petItems
		{pending}
		{showPetPhotoUpload}
		{channel}
		{enableUnassignedPhoto}
		{shelterCode}
		onsync={onPetsSynced}
	/>

	<!-- ── Section 3: Vehicles + assets (optional; onsite default) ──────── -->
	{#if showVehiclesAssets}
		<UnifiedRegistrationVehiclesSection
			bind:vehicles={
				() => household.vehicles ?? [],
				(v) => {
					household.vehicles = v;
				}
			}
			bind:assetDescription
			{pending}
			onDirty={markDirty}
		/>
	{/if}

	<!-- ── Section 4: Members ─────────────────────────────────── -->
	<UnifiedRegistrationMembersSection
		bind:members
		{memberFieldErrors}
		{pending}
		{mode}
		{channel}
		{memberPhotoUpload}
		{shelterCode}
		{membersSectionDesc}
		onDirty={markDirty}
	/>

	{#if children}
		<div class="pt-2">
			{@render children({
				household: {
					...household,
					vehicles: showVehiclesAssets ? (household.vehicles ?? []) : [],
					assets:
						showVehiclesAssets && assetDescription.trim()
							? { description: assetDescription.trim(), image_url: null }
							: null
				}
			})}
		</div>
	{/if}

	<div class="unified-reg-bottom-chrome">
		<UnifiedRegistrationStickyNav
			sections={formSectionNav}
			{activeSection}
			ariaLabel={t.sectionNavAria}
			onNavigate={(id) => scrollToSection(id as FormSectionId)}
		/>
		<UnifiedRegistrationSubmitBar
			{pending}
			{submitDisabled}
			label={effectiveSubmitLabel}
			submittingLabel={t.submitting}
			align={submitAlign}
			sticky={false}
		/>
	</div>
</form>
