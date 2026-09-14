<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Camera from '@lucide/svelte/icons/camera';
	import X from '@lucide/svelte/icons/x';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { ZodIssue } from 'zod';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useSaveImage } from '$lib/features/images';
	import {
		uploadShelterBookingPhoto,
		uploadUnassignedPhoto
	} from '$lib/features/public-register/data/public-register.api';
	import { compressImage } from '$lib/utils/image-compress';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import HouseholdAddressFields from './forms/household-address-fields.svelte';
	import UnifiedRegistrationMemberCard from './unified-registration-member-card.svelte';
	import UnifiedRegistrationSection from './unified-registration-section.svelte';
	import UnifiedRegistrationStickyNav from './unified-registration-sticky-nav.svelte';
	import UnifiedRegistrationSubmitBar from './unified-registration-submit-bar.svelte';
	import { readRegistrationStickyTopPx } from './registration-sticky-offset';
	import {
		blankUnifiedMember,
		unifiedRegistrationInputSchema,
		type MemberPhotoUploadMode,
		type UnifiedMemberWithMeta,
		type UnifiedRegistrationChannel,
		type UnifiedRegistrationInput,
		type UnifiedHouseholdInput
	} from '../domain/unified-registration';
	import {
		isMeaningfulOtherPetNotes,
		type HouseholdVehicle,
		type PetGroup
	} from '../domain/people';
	import {
		forgetPhotoPreview,
		rememberPhotoPreview,
		resolvePhotoPreviewUrl
	} from './registration-photo-preview';

	type FormSectionId = 'address' | 'pets' | 'vehicles' | 'members';

	let {
		channel = 'onsite',
		mode = 'create',
		initialHousehold = null,
		initialMembers = null,
		pending = false,
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

	$effect(() => {
		if (initialMembers && !touched) {
			members = buildInitialMembers();
		}
	});

	$effect(() => {
		if (initialHousehold && !touched) {
			household = buildInitialHousehold();
			assetDescription = initialHousehold.assets?.description ?? '';
			petItems = parseInitialPets((initialHousehold.pets ?? []) as PetGroup[]);
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

	interface PetCardItem {
		id: number;
		species: 'dog' | 'cat' | 'other';
		customSpecies: string;
		name: string;
		details: string;
		has_cage: boolean;
		image_url: string | null;
		previewUrl: string | null;
	}

	let nextPetId = 1;
	let uploadingPetId = $state<number | null>(null);

	function safeQuery<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch {
			return fallback;
		}
	}

	const saveImage = safeQuery(() => useSaveImage(), {
		mutateAsync: async () => {
			throw new Error('image upload unavailable');
		}
	} as unknown as ReturnType<typeof useSaveImage>);

	function parseInitialPets(pets: PetGroup[]): PetCardItem[] {
		const result: PetCardItem[] = [];
		for (const p of pets ?? []) {
			const count = Math.max(1, Number(p.count) || 1);
			for (let i = 0; i < count; i++) {
				const notes = p.notes ?? '';
				const parts = notes
					.split('|')
					.map((s) => s.trim())
					.filter(Boolean);
				let customSpecies = '';
				let name = '';
				const detailsList: string[] = [];

				for (const part of parts) {
					if (part.startsWith('ชื่อ:')) {
						name = part.replace(/^ชื่อ:\s*/, '').trim();
					} else if (p.species === 'other' && !customSpecies) {
						customSpecies = part;
					} else {
						detailsList.push(part);
					}
				}

				result.push({
					id: nextPetId++,
					species: p.species,
					customSpecies: p.species === 'other' ? customSpecies || notes : '',
					name,
					details: detailsList.join(' | '),
					has_cage: p.has_cage ?? false,
					image_url: p.image_url ?? null,
					previewUrl: null
				});
			}
		}
		return result;
	}

	let petItems = $state<PetCardItem[]>(
		untrack(() => parseInitialPets(household.pets as PetGroup[]))
	);
	const totalPetCount = $derived(petItems.length);

	function revokePetPreview(pet: PetCardItem) {
		if (pet.previewUrl?.startsWith('blob:') && pet.image_url) {
			// Session cache owns the blob for remount restore.
			pet.previewUrl = null;
			return;
		}
		if (pet.previewUrl?.startsWith('blob:')) {
			URL.revokeObjectURL(pet.previewUrl);
		}
		pet.previewUrl = null;
	}

	function syncPetsToHousehold() {
		household.pets = petItems.map((p) => {
			const notesParts: string[] = [];
			if (p.species === 'other' && p.customSpecies.trim()) {
				notesParts.push(p.customSpecies.trim());
			}
			if (p.name.trim()) {
				notesParts.push(`ชื่อ: ${p.name.trim()}`);
			}
			if (p.details.trim()) {
				notesParts.push(p.details.trim());
			}
			const notes =
				notesParts.length > 0
					? notesParts.join(' | ')
					: p.species === 'other'
						? p.customSpecies.trim()
						: undefined;
			return {
				species: p.species,
				count: 1,
				notes,
				has_cage: p.has_cage,
				image_url: p.image_url
			};
		});
		markDirty();
	}

	$effect(() => {
		const mode = channel === 'onsite' ? 'pet-onsite' : 'pet-public';
		for (const pet of petItems) {
			if (!pet.image_url || pet.previewUrl) continue;
			const id = pet.image_url;
			void resolvePhotoPreviewUrl(id, mode).then((url) => {
				const target = petItems.find((p) => p.id === pet.id && p.image_url === id);
				if (target && url) {
					target.previewUrl = url;
					petItems = [...petItems];
				}
			});
		}
	});

	onDestroy(() => {
		// Cached preview blobs are kept for remount; drop only unbound local blobs.
		for (const p of petItems) {
			if (p.previewUrl?.startsWith('blob:') && !p.image_url) {
				URL.revokeObjectURL(p.previewUrl);
			}
		}
	});

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
			const observer = new IntersectionObserver(
				(entries) => {
					if (scrollSpyPaused) return;
					const visible = entries
						.filter((entry) => entry.isIntersecting)
						.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
					const target = visible[0]?.target;
					if (!(target instanceof HTMLElement) || !target.id.startsWith('unified-')) return;
					const id = target.id.replace('unified-', '') as FormSectionId;
					if (formSectionNav.some((s) => s.id === id)) activeSection = id;
				},
				{
					root: scrollRoot,
					rootMargin: `-${Math.round(stickyTopPx + 8)}px 0px -55% 0px`,
					threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
				}
			);

			for (const el of sectionNodes()) observer.observe(el);
			return () => observer.disconnect();
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

	function addMember() {
		if (pending) return;
		const newMember: UnifiedMemberWithMeta = {
			...blankUnifiedMember(),
			reporting_in: true
		};
		members = [...members, newMember];
		markDirty();
	}

	function removeMember(index: number) {
		if (pending) return;
		if (mode === 'report-in') {
			if (members[index]?._id) return;
		} else {
			if (index === 0 || members.length <= 1) return;
		}
		members = members.filter((_, i) => i !== index);
		markDirty();
	}

	function addPet(species: 'dog' | 'cat' | 'other') {
		if (pending) return;
		if (petItems.length >= 20) {
			toast.error(t.petMaxReached);
			return;
		}
		petItems = [
			...petItems,
			{
				id: nextPetId++,
				species,
				customSpecies: '',
				name: '',
				details: '',
				has_cage: false,
				image_url: null,
				previewUrl: null
			}
		];
		syncPetsToHousehold();
	}

	function removePet(id: number) {
		if (pending) return;
		const removed = petItems.find((p) => p.id === id);
		if (removed) {
			forgetPhotoPreview(removed.image_url);
			revokePetPreview(removed);
		}
		petItems = petItems.filter((p) => p.id !== id);
		syncPetsToHousehold();
	}

	async function onPetPhotoChange(petId: number, e: Event) {
		if (pending || !showPetPhotoUpload) return;
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;

		const pet = petItems.find((p) => p.id === petId);
		if (!pet) return;

		if (pet.species === 'other' && !isMeaningfulOtherPetNotes(pet.customSpecies)) {
			toast.error(t.petSpeciesRequiredBeforePhoto);
			return;
		}

		uploadingPetId = petId;
		try {
			const localPreview = URL.createObjectURL(file);
			let photoId: string;
			if (channel === 'onsite') {
				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};
				const res = await saveImage.mutateAsync({ file, ctx });
				photoId = res._id;
			} else {
				const compressed = await compressImage(file);
				const contentType = compressed.full.type || 'image/webp';
				const filename = file.name || 'pet.webp';
				const form = new FormData();
				form.append('full', compressed.full, filename);
				form.append('thumb', compressed.thumbnail, 'thumb.webp');
				form.append('filename', filename);
				form.append('content_type', contentType);
				form.append('width', String(compressed.width));
				form.append('height', String(compressed.height));
				form.append('original_size', String(compressed.originalSize));
				form.append('compressed_size', String(compressed.compressedSize));
				form.append('thumbnail_size', String(compressed.thumbnailSize));
				const res = enableUnassignedPhoto
					? await uploadUnassignedPhoto(form)
					: await uploadShelterBookingPhoto(shelterCode.trim(), form);
				photoId = res.photo_id;
			}
			if (pet.image_url && pet.image_url !== photoId) {
				forgetPhotoPreview(pet.image_url);
			}
			revokePetPreview(pet);
			pet.previewUrl = localPreview;
			pet.image_url = photoId;
			rememberPhotoPreview(photoId, localPreview);
			syncPetsToHousehold();
			toast.success(t.petPhotoUploadOk);
		} catch {
			toast.error(t.petPhotoUploadFail);
		} finally {
			uploadingPetId = null;
		}
	}

	function clearPetPhoto(petId: number) {
		if (pending || uploadingPetId === petId) return;
		const pet = petItems.find((p) => p.id === petId);
		if (!pet) return;
		forgetPhotoPreview(pet.image_url);
		revokePetPreview(pet);
		pet.image_url = null;
		syncPetsToHousehold();
	}

	function getPetTitle(item: PetCardItem): string {
		const sameSpecies = petItems.filter((p) => p.species === item.species);
		const indexInSpecies = sameSpecies.findIndex((p) => p.id === item.id) + 1;
		if (item.species === 'dog') {
			return `${t.dogTitle} — ${t.petIndexSuffix} ${indexInSpecies}`;
		}
		if (item.species === 'cat') {
			return `${t.catTitle} — ${t.petIndexSuffix} ${indexInSpecies}`;
		}
		const label = item.customSpecies.trim() ? item.customSpecies.trim() : t.otherPetTitle;
		return `${label} — ${t.petIndexSuffix} ${indexInSpecies}`;
	}

	function addVehicle() {
		if (pending) return;
		household.vehicles = [...(household.vehicles ?? []), { type: 'car', license_plate: '' }];
		markDirty();
	}

	function removeVehicle(index: number) {
		if (pending) return;
		household.vehicles = (household.vehicles ?? []).filter((_, i) => i !== index);
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
		syncPetsToHousehold();

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
			required={true}
			disabled={pending}
		/>
	</UnifiedRegistrationSection>

	<!-- ── Section 2: Pets ────────────────────────────────────────── -->
	<UnifiedRegistrationSection
		id="unified-pets"
		title={t.sectionPets}
		description={t.sectionPetsDesc}
		badge={totalPetCount > 0
			? `${totalPetCount}${t.petCountUnit ? ` ${t.petCountUnit}` : ''}`
			: null}
		icon={PawPrint}
	>
		{#snippet actions()}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={pending || petItems.length >= 20}
				onclick={() => addPet('dog')}
				class="h-8 gap-1 text-xs"
			>
				<Plus class="size-3.5" />
				{t.addDog}
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={pending || petItems.length >= 20}
				onclick={() => addPet('cat')}
				class="h-8 gap-1 text-xs"
			>
				<Plus class="size-3.5" />
				{t.addCat}
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={pending || petItems.length >= 20}
				onclick={() => addPet('other')}
				class="h-8 gap-1 text-xs"
			>
				<Plus class="size-3.5" />
				{t.addOtherPet}
			</Button>
		{/snippet}

		{#if petItems.length === 0}
			<div
				class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-6 text-center"
			>
				<PawPrint class="size-8 text-muted-foreground/50" />
				<p class="text-sm font-medium text-foreground">{t.sectionPetsEmpty}</p>
				<p class="text-xs text-muted-foreground">{t.sectionPetsEmptyHint}</p>
				<div class="mt-2 flex flex-wrap justify-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending || petItems.length >= 20}
						onclick={() => addPet('dog')}
						class="h-8 gap-1 text-xs"
					>
						<Plus class="size-3.5" />
						{t.addDogFull}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending || petItems.length >= 20}
						onclick={() => addPet('cat')}
						class="h-8 gap-1 text-xs"
					>
						<Plus class="size-3.5" />
						{t.addCatFull}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={pending || petItems.length >= 20}
						onclick={() => addPet('other')}
						class="h-8 gap-1 text-xs"
					>
						<Plus class="size-3.5" />
						{t.addOtherPetFull}
					</Button>
				</div>
			</div>
		{:else}
			<div class="space-y-3">
				{#each petItems as pet (pet.id)}
					<div class="space-y-3 rounded-lg border border-border/60 bg-slate-50/50 p-3 sm:p-4">
						<div
							class="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2"
						>
							<div class="flex items-center gap-2">
								<span
									class="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold
									{pet.species === 'dog'
										? 'border-amber-200 bg-amber-50 text-amber-900'
										: pet.species === 'cat'
											? 'border-sky-200 bg-sky-50 text-sky-900'
											: 'border-emerald-200 bg-emerald-50 text-emerald-900'}"
								>
									{pet.species === 'dog'
										? t.dogTitle
										: pet.species === 'cat'
											? t.catTitle
											: t.otherPetTitle}
								</span>
								<span class="text-sm font-bold text-foreground">
									{getPetTitle(pet)}
								</span>
							</div>

							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={pending}
								onclick={() => removePet(pet.id)}
								class="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
							>
								<Trash2 class="mr-1 size-3.5" />
								{t.removeBtn}
							</Button>
						</div>

						<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{#if pet.species === 'other'}
								<div class="space-y-1">
									<Label class="text-2xs font-medium text-muted-foreground">
										{t.petSpeciesCustomLabel} <span class="text-destructive">*</span>
									</Label>
									<Input
										placeholder={t.petSpeciesCustomPlaceholder}
										bind:value={pet.customSpecies}
										disabled={pending}
										class="h-8 text-xs"
										oninput={syncPetsToHousehold}
									/>
								</div>
							{/if}

							<div class="space-y-1 {pet.species !== 'other' ? 'sm:col-span-2' : ''}">
								<Label class="text-2xs font-medium text-muted-foreground">
									{t.petNameLabel}
								</Label>
								<Input
									placeholder={t.petNamePlaceholder}
									bind:value={pet.name}
									disabled={pending}
									class="h-8 text-xs"
									oninput={syncPetsToHousehold}
								/>
							</div>

							<div class="space-y-1 sm:col-span-2">
								<Label class="text-2xs font-medium text-muted-foreground">
									{t.petExtraLabel}
								</Label>
								<Textarea
									placeholder={t.petExtraPlaceholder}
									bind:value={pet.details}
									disabled={pending}
									rows={2}
									class="min-h-16 text-xs"
									oninput={syncPetsToHousehold}
								/>
							</div>

							<div class="flex items-center pt-1 sm:col-span-2">
								<label
									class="flex cursor-pointer items-center gap-2 text-xs text-foreground select-none"
								>
									<Checkbox
										checked={pet.has_cage}
										onCheckedChange={(v) => {
											pet.has_cage = v === true;
											syncPetsToHousehold();
										}}
										disabled={pending}
										class="size-4"
									/>
									<span>{t.petHasCage}</span>
								</label>
							</div>

							{#if showPetPhotoUpload}
								<div class="space-y-2 sm:col-span-2">
									<Label
										for="pet-photo-{pet.id}"
										class="text-2xs font-medium text-muted-foreground"
									>
										{t.petPhotoLabel}
									</Label>
									<div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
										<div
											class="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/30"
										>
											{#if uploadingPetId === pet.id}
												<Loader2 class="size-6 animate-spin text-primary" />
											{:else if pet.previewUrl}
												<img
													src={pet.previewUrl}
													alt={t.petPhotoLabel}
													class="size-full object-cover"
												/>
											{:else}
												<Camera class="size-8 text-muted-foreground/50" />
											{/if}
										</div>
										<div class="flex flex-wrap items-center gap-2">
											<label
												for="pet-photo-{pet.id}"
												class="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted {pending ||
												uploadingPetId === pet.id
													? 'pointer-events-none opacity-60'
													: ''}"
											>
												<Camera class="size-3.5 text-primary" />
												<span>
													{pet.previewUrl || pet.image_url ? t.petPhotoChange : t.petPhotoPick}
												</span>
											</label>
											<input
												id="pet-photo-{pet.id}"
												type="file"
												accept="image/*"
												class="sr-only"
												disabled={pending || uploadingPetId === pet.id}
												onchange={(e) => void onPetPhotoChange(pet.id, e)}
											/>
											{#if pet.previewUrl || pet.image_url}
												<Button
													type="button"
													variant="ghost"
													size="sm"
													disabled={pending || uploadingPetId === pet.id}
													onclick={() => clearPetPhoto(pet.id)}
													class="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
													aria-label={t.petPhotoRemove}
												>
													<X class="size-3.5" />
													{t.petPhotoRemove}
												</Button>
											{/if}
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</UnifiedRegistrationSection>

	<!-- ── Section 3: Vehicles + assets (optional; onsite default) ──────── -->
	{#if showVehiclesAssets}
		<UnifiedRegistrationSection
			id="unified-vehicles"
			title={t.sectionVehicles}
			description={t.sectionVehiclesDesc}
			badge={(household.vehicles ?? []).length > 0
				? `${(household.vehicles ?? []).length}${t.vehicleCountUnit ? ` ${t.vehicleCountUnit}` : ''}`
				: null}
			icon={Package}
		>
			{#snippet actions()}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending}
					onclick={addVehicle}
					class="h-8 gap-1 text-xs"
				>
					<Plus class="size-3.5" />
					{t.addVehicle}
				</Button>
			{/snippet}

			{#if (household.vehicles ?? []).length === 0}
				<p class="text-xs text-muted-foreground">{t.vehicleEmpty}</p>
			{:else}
				<div class="space-y-2">
					{#each household.vehicles ?? [] as vehicle, index (index)}
						<div
							class="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 bg-slate-50/50 p-2.5"
						>
							<div class="w-[140px] shrink-0 space-y-1">
								<Label class="text-2xs text-muted-foreground">{t.vehicleTypeLabel}</Label>
								<Select.Root
									type="single"
									value={vehicle.type}
									onValueChange={(val) => {
										if (val === 'car' || val === 'motorcycle' || val === 'other') {
											vehicle.type = val;
											household.vehicles = [...(household.vehicles ?? [])];
											markDirty();
										}
									}}
									disabled={pending}
								>
									<Select.Trigger class="!h-8 w-full rounded-md text-xs">
										{vehicle.type === 'car'
											? t.vehicleTypeCar
											: vehicle.type === 'motorcycle'
												? t.vehicleTypeMotorcycle
												: t.vehicleTypeOther}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="car" label={t.vehicleTypeCar} />
										<Select.Item value="motorcycle" label={t.vehicleTypeMotorcycle} />
										<Select.Item value="other" label={t.vehicleTypeOther} />
									</Select.Content>
								</Select.Root>
							</div>
							<div class="min-w-[140px] flex-1 space-y-1">
								<Label class="text-2xs text-muted-foreground">{t.licensePlateLabel}</Label>
								<Input
									class="h-8"
									value={vehicle.license_plate ?? ''}
									disabled={pending}
									oninput={(e) => {
										vehicle.license_plate = (e.currentTarget as HTMLInputElement).value;
										household.vehicles = [...(household.vehicles ?? [])];
										markDirty();
									}}
								/>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={pending}
								onclick={() => removeVehicle(index)}
								class="h-8 text-xs text-destructive hover:text-destructive"
							>
								<Trash2 class="mr-1 size-3.5" />
								{t.removeBtn}
							</Button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="space-y-1.5 border-t border-border/60 pt-4">
				<Label for="family-assets" class="text-xs font-semibold text-foreground">
					{t.assetsLabel}
				</Label>
				<Textarea
					id="family-assets"
					bind:value={assetDescription}
					disabled={pending}
					rows={2}
					placeholder={t.assetsPlaceholder}
					class="min-h-16 text-sm"
				/>
			</div>
		</UnifiedRegistrationSection>
	{/if}

	<!-- ── Section 4: Members ─────────────────────────────────── -->
	<UnifiedRegistrationSection
		id="unified-members"
		title={t.sectionMembers}
		description={membersSectionDesc}
		badge={`${members.length}${t.memberCountUnit ? ` ${t.memberCountUnit}` : ''}`}
		icon={Users}
		bodyClass="none"
	>
		{#snippet actions()}
			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onclick={addMember}
				class="h-9 gap-1.5"
			>
				<Plus class="size-4" />
				{t.addMember}
			</Button>
		{/snippet}

		<div class="space-y-4">
			{#each [...members.keys()] as index (index)}
				<UnifiedRegistrationMemberCard
					bind:member={
						() => members[index]!,
						(v) => {
							members[index] = v;
							members = [...members];
						}
					}
					{index}
					canRemove={mode === 'report-in' ? !members[index]?._id : index > 0}
					{mode}
					onReportingInChange={(reportingIn) => {
						if (members[index]) {
							members[index].reporting_in = reportingIn;
							members = [...members];
							markDirty();
						}
					}}
					disabled={pending}
					photoUpload={memberPhotoUpload}
					shelterCode={shelterCode.trim()}
					{channel}
					excludeIds={members.map((m) => m._id).filter((id): id is string => Boolean(id))}
					fieldErrors={memberFieldErrors[index]}
					onRemove={() => removeMember(index)}
				/>
			{/each}
		</div>
	</UnifiedRegistrationSection>

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
			label={effectiveSubmitLabel}
			submittingLabel={t.submitting}
			align={submitAlign}
			sticky={false}
		/>
	</div>
</form>
