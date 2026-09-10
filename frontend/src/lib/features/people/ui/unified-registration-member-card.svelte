<script lang="ts">
	import Camera from '@lucide/svelte/icons/camera';
	import Check from '@lucide/svelte/icons/check';
	import IdCard from '@lucide/svelte/icons/id-card';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Phone from '@lucide/svelte/icons/phone';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { useSaveImage } from '$lib/features/images';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		uploadShelterBookingPhoto,
		uploadUnassignedPhoto
	} from '$lib/features/public-register/data/public-register.api';
	import { compressImage } from '$lib/utils/image-compress';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { cn } from '$lib/utils/shadcn.js';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import {
		PersonalInfoFields,
		EmergencyContactFields,
		SpecialNeedsFields,
		VulnerableGroupsFields
	} from './forms/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { STATUS_LABELS } from '../domain/people';
	import {
		applyAnonymousIdToMember,
		type MemberPhotoUploadMode,
		type UnifiedMemberInput,
		type UnifiedMemberWithMeta,
		type UnifiedRegistrationChannel
	} from '../domain/unified-registration';
	import {
		forgetPhotoPreview,
		rememberPhotoPreview,
		resolvePhotoPreviewUrl
	} from './registration-photo-preview';

	let {
		member = $bindable<UnifiedMemberWithMeta>(),
		index,
		canRemove = false,
		disabled = false,
		photoUpload = 'none',
		shelterCode = '',
		channel = 'onsite',
		mode = 'create',
		fieldErrors,
		onRemove,
		onReportingInChange
	}: {
		member: UnifiedMemberWithMeta;
		index: number;
		canRemove?: boolean;
		disabled?: boolean;
		photoUpload?: MemberPhotoUploadMode;
		shelterCode?: string;
		channel?: UnifiedRegistrationChannel;
		mode?: 'create' | 'report-in';
		fieldErrors?: Record<string, string | undefined>;
		onRemove?: () => void;
		onReportingInChange?: (reportingIn: boolean) => void;
	} = $props();

	const t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));
	const isPrimary = $derived(index === 0);
	const title = $derived(isPrimary ? t.primaryContact : `${t.memberLabel} ${index + 1}`);
	const photoInputId = $derived(`unified-member-photo-${index}`);
	const showPhotoUpload = $derived(photoUpload !== 'none');
	const hideNoPhone = $derived(channel === 'public' && index === 0);

	const isReportIn = $derived(mode === 'report-in');
	const isAlreadyReported = $derived(
		isReportIn && !!member.stay_status && member.stay_status !== 'pre_registered'
	);
	const alreadyReportedStatusLabel = $derived(
		member.stay_status ? (STATUS_LABELS[member.stay_status] ?? member.stay_status) : ''
	);
	const isNewReportInMember = $derived(isReportIn && !member._id);
	const isToggleableReportIn = $derived(
		isReportIn && !!member._id && (!member.stay_status || member.stay_status === 'pre_registered')
	);
	const isReportingInSelected = $derived(member.reporting_in ?? true);
	const cardClass = $derived(
		cn(
			'rounded-xl p-4 shadow-xs sm:p-5 space-y-5',
			isToggleableReportIn
				? isReportingInSelected
					? 'border-2 border-primary/50 bg-sky-100/5 ring-1 ring-primary/30'
					: 'border-2 border-dashed border-border bg-white text-muted-foreground opacity-70'
				: isAlreadyReported
					? 'border border-border bg-muted/40 text-muted-foreground'
					: isNewReportInMember
						? 'border border-emerald-300 bg-emerald-50/50'
						: 'border border-border/60 bg-card'
		)
	);

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

	if (!member.person_id) {
		member.person_id = { cardType: 'national_id', number: '' };
	}
	if (!member.emergency_contact) {
		member.emergency_contact = { name: '', phone: '', relation: '' };
	}
	if (!member.vulnerable_groups) member.vulnerable_groups = [];
	if (!member.special_needs) member.special_needs = [];
	if (member.first_name == null) member.first_name = '';
	if (member.last_name == null) member.last_name = '';
	if (member.nickname == null) member.nickname = '';
	if (member.country == null) member.country = 'THAILAND';
	if (member.religion == null) member.religion = 'unknown';
	if (member.gender == null || (member.gender as string) === 'other') {
		member.gender = '' as UnifiedMemberInput['gender'];
	}

	let noPhone = $state(member.phone == null);
	let birthYear = $state<string | number | undefined>(
		typeof member.birth_year === 'number' || typeof member.birth_year === 'string'
			? member.birth_year
			: ''
	);
	let age = $state<string | number | undefined>(
		typeof member.age === 'number' || typeof member.age === 'string' ? member.age : ''
	);
	let emergency = $state({
		name: member.emergency_contact?.name ?? '',
		phone: member.emergency_contact?.phone ?? '',
		relation: member.emergency_contact?.relation ?? ''
	});
	let photoPreviewUrl = $state<string | null>(null);
	let uploadingPhoto = $state(false);

	$effect(() => {
		if (hideNoPhone) {
			noPhone = false;
		}
	});

	$effect(() => {
		if (noPhone) {
			member.phone = null;
		} else if (member.phone == null) {
			member.phone = '';
		}
	});

	const resolvedBirthYear = $derived.by(() => {
		const parsed =
			typeof birthYear === 'string'
				? Number.parseInt(birthYear, 10)
				: typeof birthYear === 'number'
					? birthYear
					: Number.NaN;
		return Number.isFinite(parsed) ? parsed : undefined;
	});

	const resolvedAge = $derived.by(() => {
		const parsed =
			typeof age === 'string'
				? Number.parseInt(age, 10)
				: typeof age === 'number'
					? age
					: Number.NaN;
		return Number.isFinite(parsed) ? parsed : undefined;
	});

	$effect(() => {
		member.birth_year = resolvedBirthYear;
	});

	$effect(() => {
		member.age = resolvedAge;
	});

	$effect(() => {
		member.emergency_contact = {
			name: emergency.name,
			phone: emergency.phone,
			relation: emergency.relation
		};
	});

	$effect(() => {
		const photoId = member.photo;
		const mode = photoUpload;
		let cancelled = false;

		if (!photoId || !showPhotoUpload) {
			photoPreviewUrl = null;
			return;
		}

		void resolvePhotoPreviewUrl(photoId, mode).then((url) => {
			if (!cancelled && url) photoPreviewUrl = url;
		});

		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		// Keep session-cached blob URLs for remount restore; only clear local ref.
		photoPreviewUrl = null;
	});

	function applyAnonymous() {
		if (disabled) return;
		member = applyAnonymousIdToMember(member);
	}

	async function buildCompressedForm(file: File): Promise<FormData> {
		const compressed = await compressImage(file);
		const contentType = compressed.full.type || 'image/webp';
		const filename = file.name || 'face.webp';
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
		return form;
	}

	async function handlePhotoSelect(file: File | null) {
		if (!file || disabled || uploadingPhoto || !showPhotoUpload) return;

		uploadingPhoto = true;
		const localPreview = URL.createObjectURL(file);
		photoPreviewUrl = localPreview;

		try {
			let photoId: string;
			if (photoUpload === 'onsite-couch') {
				const ctx = {
					shelterCode: getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				};
				const res = await saveImage.mutateAsync({ file, ctx });
				photoId = res._id;
			} else if (photoUpload === 'shelter-couch') {
				const code = shelterCode.trim();
				if (!code) throw new Error(t.selectShelterFirst);
				const form = await buildCompressedForm(file);
				const res = await uploadShelterBookingPhoto(code, form);
				photoId = res.photo_id;
			} else {
				const form = await buildCompressedForm(file);
				const res = await uploadUnassignedPhoto(form);
				photoId = res.photo_id;
			}
			if (member.photo && member.photo !== photoId) {
				forgetPhotoPreview(member.photo);
			}
			member.photo = photoId;
			rememberPhotoPreview(photoId, localPreview);
			toast.success(t.facePhotoUploadOk);
		} catch (err) {
			URL.revokeObjectURL(localPreview);
			photoPreviewUrl = null;
			member.photo = null;
			const msg = err instanceof Error ? err.message : t.facePhotoUploadFail;
			toast.error(msg);
		} finally {
			uploadingPhoto = false;
		}
	}

	function clearPhoto() {
		if (disabled || uploadingPhoto) return;
		forgetPhotoPreview(member.photo);
		photoPreviewUrl = null;
		member.photo = null;
	}
</script>

<section id="unified-member-{index}" class={cardClass} aria-labelledby="member-card-title-{index}">
	<div class="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h3
					id="member-card-title-{index}"
					class={cn(
						'text-base font-bold',
						isToggleableReportIn && !isReportingInSelected
							? 'text-muted-foreground'
							: 'text-foreground'
					)}
				>
					{title}
				</h3>
				{#if isReportIn}
					{#if isAlreadyReported}
						<Badge variant="secondary" class="text-2xs">
							รายงานตัวแล้ว ({alreadyReportedStatusLabel})
						</Badge>
					{:else if member._id}
						<Badge
							variant="outline"
							class="border-amber-500/40 bg-amber-500/10 text-2xs text-amber-700 dark:text-amber-400"
						>
							ลงทะเบียนล่วงหน้า
						</Badge>
					{:else}
						<Badge variant="default" class="bg-emerald-600 text-2xs text-white">
							สมาชิกใหม่ (รายงานตัวทันที)
						</Badge>
					{/if}
				{/if}
			</div>
			{#if isPrimary}
				<p class="text-xs text-muted-foreground">{t.primaryContactHint}</p>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if isReportIn}
				{#if isAlreadyReported}
					<span
						class="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500"
					>
						เข้ารายงานตัวแล้ว
					</span>
				{:else if isNewReportInMember}
					<span
						class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800"
					>
						<Check class="size-4 shrink-0" aria-hidden="true" />
						รายงานตัวรอบนี้
					</span>
				{:else}
					<label
						class={cn(
							'flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3.5 py-2.5 text-sm font-semibold transition-colors select-none',
							isReportingInSelected
								? 'border-primary/50 bg-primary/10 text-primary shadow-2xs ring-1 ring-primary/30'
								: 'border-dashed border-border bg-muted/50 text-muted-foreground'
						)}
					>
						<Checkbox
							checked={isReportingInSelected}
							{disabled}
							onCheckedChange={(checked) => {
								member.reporting_in = checked === true;
								onReportingInChange?.(checked === true);
							}}
						/>
						{#if isReportingInSelected}
							<Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
							<span>เลือกแล้ว — รายงานตัวรอบนี้</span>
						{:else}
							<span>ยังไม่เลือก — ไม่มาในรอบนี้</span>
						{/if}
					</label>
				{/if}
			{/if}

			<Button
				type="button"
				variant="outline"
				size="sm"
				{disabled}
				onclick={applyAnonymous}
				class="h-9 gap-1.5 text-xs"
			>
				<IdCard class="size-3.5" />
				{t.anonymousBtn}
			</Button>
			{#if canRemove}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					{disabled}
					onclick={() => onRemove?.()}
					class="h-9 gap-1.5 text-xs text-destructive hover:text-destructive"
					aria-label={t.removeMemberAria}
				>
					<Trash2 class="size-3.5" />
					{t.removeBtn}
				</Button>
			{/if}
		</div>
	</div>

	{#if showPhotoUpload}
		<div class="space-y-3">
			<div class="flex items-center gap-2">
				<Camera class="size-4 text-primary" />
				<h4 class="text-sm font-semibold text-foreground">{t.facePhotoTitle}</h4>
			</div>
			<div class="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
				<div
					class="relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30"
				>
					{#if uploadingPhoto}
						<Loader2 class="size-8 animate-spin text-primary" />
					{:else if photoPreviewUrl}
						<img src={photoPreviewUrl} alt={t.facePhotoTitle} class="size-full object-cover" />
					{:else}
						<Camera class="size-10 text-muted-foreground/50" />
					{/if}
				</div>
				<div class="space-y-2 text-center sm:text-left">
					<p class="text-xs text-muted-foreground">{t.facePhotoHint}</p>
					<div class="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
						<label
							for={photoInputId}
							class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-muted {disabled ||
							uploadingPhoto
								? 'pointer-events-none opacity-60'
								: ''}"
						>
							<Camera class="size-4 text-primary" />
							<span>{photoPreviewUrl || member.photo ? t.facePhotoChange : t.facePhotoPick}</span>
						</label>
						<input
							id={photoInputId}
							type="file"
							accept="image/*"
							capture="user"
							class="sr-only"
							disabled={disabled || uploadingPhoto}
							onchange={(e) => {
								const input = e.currentTarget;
								void handlePhotoSelect(input.files?.[0] ?? null);
								input.value = '';
							}}
						/>
						{#if photoPreviewUrl || member.photo}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="min-h-11 text-destructive hover:bg-destructive/10"
								disabled={disabled || uploadingPhoto}
								onclick={clearPhoto}
							>
								{t.facePhotoRemove}
							</Button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<IdCard class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">{t.identitySection}</h4>
		</div>
		<PersonalInfoFields
			bind:first_name={member.first_name}
			bind:last_name={member.last_name}
			bind:nickname={member.nickname}
			bind:person_id={member.person_id}
			bind:phone={member.phone}
			bind:no_phone={noPhone}
			bind:birth_year={birthYear}
			bind:age
			bind:gender={member.gender}
			bind:religion={member.religion}
			bind:country={member.country}
			{disabled}
			{hideNoPhone}
			idPrefix="member-{index}"
			errors={fieldErrors}
		/>
	</div>

	<div class="space-y-4">
		<div class="flex items-center gap-2">
			<Phone class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">{t.emergencySection}</h4>
		</div>
		<EmergencyContactFields
			bind:name={emergency.name}
			bind:phone={emergency.phone}
			bind:relation={emergency.relation}
			{disabled}
		/>
	</div>

	<div class="space-y-2.5">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<ShieldAlert class="size-4 text-primary" />
				<h4 class="text-sm font-semibold text-foreground">{t.vulnerableSection}</h4>
			</div>
			<span class="text-2xs text-muted-foreground">{t.vulnerableMultiHint}</span>
		</div>
		<VulnerableGroupsFields
			bind:vulnerable_groups={member.vulnerable_groups}
			{disabled}
			idPrefix="vg-{index}"
			label=""
		/>
	</div>

	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<HeartPulse class="size-4 text-primary" />
			<h4 class="text-sm font-semibold text-foreground">{t.specialNeedsSection}</h4>
		</div>
		<SpecialNeedsFields bind:special_needs={member.special_needs} {disabled} label="" />
	</div>
</section>
