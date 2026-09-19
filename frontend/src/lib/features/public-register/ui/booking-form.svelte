<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Info from '@lucide/svelte/icons/info';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { onMount, untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { env } from '$env/dynamic/public';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { PublicShelterCardModel } from '$lib/features/public-portal';
	import {
		useCreateBooking,
		useCreateUnassignedRegistration,
		useShelterPolicy
	} from '../application/queries';
	import type { ShelterSummary } from '$lib/features/shelters';
	import type { BookingTicket } from '../application/booking-store.svelte';
	import { saveTicketToStorage } from '../data/ticket-storage';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_BOOKING_FORM_I18N } from '$lib/constants/i18n';
	import { buildDisclaimerGroups } from '$lib/features/people/domain/disclaimer';
	import { UNASSIGNED_SHELTER_CODE } from '../domain/booking';
	import { UnifiedRegistrationForm, type UnifiedRegistrationInput } from '$lib/features/people';
	import { fetchRecaptchaEnabled } from '$lib/api/recaptcha-status';

	interface Props {
		shelters: (PublicShelterCardModel & { available: number | null })[];
		lockedShelterCode?: string;
		onbooked: (ticket: BookingTicket) => void;
	}

	let { shelters, lockedShelterCode = '', onbooked }: Props = $props();

	let t = $derived(getTranslation(PUBLIC_BOOKING_FORM_I18N, langState.current));

	const createBooking = useCreateBooking();
	const createUnassignedRegistration = useCreateUnassignedRegistration();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	let captchaEnabled = $state(false);

	let selectedShelterCode = $state(untrack(() => lockedShelterCode));
	let disclaimerAcknowledged = $state(false);

	const isUnassigned = $derived(selectedShelterCode === UNASSIGNED_SHELTER_CODE);
	const bookable = $derived(
		shelters.filter((s) => s.status !== 'CLOSED' && s.accepts_pre_registration === true)
	);
	const selected = $derived(shelters.find((s) => s.code === selectedShelterCode) ?? null);
	const selectedIsBookable = $derived(
		isUnassigned || bookable.some((s) => s.code === selectedShelterCode)
	);
	const hasShelter = $derived(selected !== null && selectedIsBookable);
	const isShelterOrQueueChosen = $derived(hasShelter || isUnassigned);
	/** Unassigned flow: confirm stays disabled until disclaimer consent is checked. */
	const submitDisabled = $derived(isUnassigned && !disclaimerAcknowledged);

	const shelterPolicyQuery = useShelterPolicy(() => selected?.code ?? '');
	const shelterPolicy = $derived(shelterPolicyQuery.data);

	onMount(() => {
		void fetchRecaptchaEnabled().then((enabled) => {
			captchaEnabled = enabled;
		});
	});

	function capacityLabel(s: { capacity: number; available: number | null }): string {
		return s.available === null
			? `${s.capacity} ${t.unitPlaces}`
			: `ว่าง ${s.available} / ${s.capacity} ${t.unitPlaces}`;
	}

	async function captchaToken(): Promise<string | null> {
		const injected = (window as unknown as { __captchaToken?: string }).__captchaToken || '';
		if (injected) return injected;
		if (!captchaEnabled) return '';
		const win = window;
		if (win.grecaptcha) {
			try {
				const action = isUnassigned ? 'unassigned_register' : 'register';
				if (win.grecaptcha.enterprise) {
					await new Promise<void>((resolve) => win.grecaptcha!.enterprise!.ready(() => resolve()));
					return await win.grecaptcha.enterprise.execute(siteKey, { action });
				}
				if (win.grecaptcha.execute) {
					return await win.grecaptcha.execute(siteKey, { action });
				}
			} catch {
				return null;
			}
		}
		return '';
	}

	let isSubmitting = $state(false);

	async function handleUnifiedSubmit(unifiedInput: UnifiedRegistrationInput) {
		if (!isUnassigned && !selectedIsBookable) {
			const err = 'ศูนย์นี้ยังไม่เปิดรับลงทะเบียนล่วงหน้าจากหน้าสาธารณะ';
			toast.error(err);
			throw new Error(err);
		}
		if (isUnassigned) {
			if (!disclaimerAcknowledged) {
				const err = t.unassignedDisclaimerRequired;
				toast.error(err);
				throw new Error(err);
			}
		} else {
			const groups = buildDisclaimerGroups({
				assetDescription: unifiedInput.household.assets?.description ?? '',
				petCount: (unifiedInput.household.pets ?? []).length,
				vehicleCount: (unifiedInput.household.vehicles ?? []).length,
				shelter: shelterPolicy as unknown as ShelterSummary
			});
			if (groups.length > 0 && !disclaimerAcknowledged) {
				const err = 'กรุณากดยืนยันการรับทราบเงื่อนไขและมาตรการด้านความปลอดภัยของศูนย์พักพิง';
				toast.error(err);
				throw new Error(err);
			}
		}

		isSubmitting = true;
		try {
			const enabled = await fetchRecaptchaEnabled();
			captchaEnabled = enabled;
			const token = await captchaToken();
			if (enabled && !token) {
				toast.error(t.recaptchaError);
				throw new Error(t.recaptchaError);
			}

			const head = unifiedInput.members[0];

			if (isUnassigned) {
				// Single path: pass UnifiedRegistrationInput through BFF → Mongo executor (#255).
				const res = await createUnassignedRegistration.mutateAsync({
					...unifiedInput,
					disclaimerAcknowledged: true,
					...(token ? { captchaToken: token } : {})
				});

				toast.success('ลงทะเบียนสำเร็จ');
				const ticket: BookingTicket = {
					code: res.id,
					shelter_code: UNASSIGNED_SHELTER_CODE,
					shelter_name: 'ไม่ระบุศูนย์พักพิง',
					first_name: head.first_name,
					last_name: head.last_name ?? '',
					status: res.status,
					booked_at: res.created_at,
					type: 'unassigned_queue',
					member_count: res.members?.length ?? unifiedInput.members.length
				};
				saveTicketToStorage(ticket);
				onbooked(ticket);
				return;
			}

			const res = await createBooking.mutateAsync({
				...unifiedInput,
				shelter_code: selectedShelterCode,
				...(token ? { captchaToken: token } : {}),
				disclaimerAcknowledged
			});

			toast.success(t.bookingSuccess);
			const ticket: BookingTicket = {
				code: res.code,
				shelter_code: res.shelter_code,
				shelter_name: selected?.name ?? res.shelter_name ?? res.shelter_code,
				first_name: head.first_name,
				last_name: head.last_name ?? '',
				status: res.status,
				booked_at: res.booked_at,
				type: 'shelter_booking',
				member_count: unifiedInput.members.length
			};
			saveTicketToStorage(ticket);
			onbooked(ticket);
		} catch (err) {
			const msg = err instanceof Error ? err.message : t.bookingErrorFallback;
			toast.error(msg);
			throw err;
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	{#if captchaEnabled}
		<script
			src="https://www.google.com/recaptcha/enterprise.js?render={siteKey}"
			async
			defer
		></script>
	{/if}
</svelte:head>

<div class="space-y-5">
	<!-- Guidance banner -->
	<div
		class="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground shadow-2xs"
	>
		<QrCode class="mt-0.5 h-5 w-5 shrink-0 text-primary" />
		<div>
			<p class="font-bold text-primary">💡 ลงทะเบียนล่วงหน้าเพื่อความสะดวกและรวดเร็ว</p>
			<p class="mt-0.5 text-xs text-muted-foreground">
				เมื่อลงทะเบียนเรียบร้อยแล้ว ท่านสามารถแจ้งเบอร์โทรศัพท์หรือแสดง QR Code
				ต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์ เพื่อยืนยันการเข้าพักได้ทันที
			</p>
		</div>
	</div>

	<!-- ── 1. ศูนย์พักพิงและผู้ติดต่อหลัก ───────────────────────────────── -->
	<section class="space-y-5 rounded-2xl border border-border/60 bg-card p-5 shadow-2xs sm:p-6">
		<div class="flex items-center gap-2.5 border-b border-border/60 pb-3">
			<MapPin class="size-5 text-primary" />
			<h3 class="text-base font-bold text-foreground sm:text-lg">{t.step1Title}</h3>
		</div>

		<div class="space-y-2">
			<div class="flex items-center justify-between gap-2">
				<Label class="text-xs font-semibold text-foreground">
					{t.shelterLabel} <span class="text-destructive">*</span>
				</Label>
				{#if selected && selected.capacity > 0}
					<span
						class="rounded-full border border-success/30 bg-success-muted/40 px-2 py-0.5 text-2xs font-semibold text-success"
					>
						{capacityLabel(selected)}
					</span>
				{/if}
			</div>
			<Select.Root
				type="single"
				value={selectedShelterCode}
				onValueChange={(v) => {
					selectedShelterCode = v;
					disclaimerAcknowledged = false;
				}}
				disabled={Boolean(lockedShelterCode)}
			>
				<Select.Trigger class="!h-10 w-full text-sm font-semibold">
					{isUnassigned ? '📍 ไม่ระบุศูนย์พักพิง' : (selected?.name ?? t.selectShelterPlaceholder)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={UNASSIGNED_SHELTER_CODE} label="📍 ไม่ระบุศูนย์พักพิง">
						<span class="flex flex-col gap-0.5 text-left">
							<span class="font-bold text-foreground">📍 ไม่ระบุศูนย์พักพิง</span>
							<span class="text-2xs break-words whitespace-normal text-muted-foreground"
								>ลงทะเบียนล่วงหน้าโดยไม่ระบุศูนย์ (ยืนยันศูนย์เมื่อเดินทางถึง)</span
							>
						</span>
					</Select.Item>
					<Select.Separator />
					{#each bookable as shelter (shelter.code)}
						<Select.Item
							value={shelter.code}
							label="{shelter.name}{shelter.status === 'FULL' ? t.shelterFullSuffix : ''}"
						>
							<span class="flex w-full items-center justify-between gap-2">
								<span class="truncate">
									{shelter.name}{shelter.status === 'FULL' ? t.shelterFullSuffix : ''}
								</span>
								{#if shelter.capacity > 0}
									<span
										class="shrink-0 rounded-full bg-success-muted px-2 py-0.5 text-2xs font-bold text-success"
									>
										{capacityLabel(shelter)}
									</span>
								{/if}
							</span>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if isUnassigned}
				<div
					class="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/10 p-3.5 text-xs text-foreground"
				>
					<Info class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
					<div>
						<p class="font-bold text-primary">กรณีไม่ระบุศูนย์พักพิง</p>
						<p class="mt-0.5 text-muted-foreground">
							การลงทะเบียนล่วงหน้า จะไม่การันตีว่าคุณจะได้เข้าพักในศูนย์
						</p>
					</div>
				</div>
			{:else if selected && !selectedIsBookable}
				<p
					class="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted/40 p-2.5 text-xs text-warning"
				>
					<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>ศูนย์นี้ยังไม่เปิดรับลงทะเบียนล่วงหน้าจากหน้าสาธารณะ</span>
				</p>
			{:else if selected}
				<p class="flex items-start gap-1 text-xs text-muted-foreground">
					<MapPin class="mt-0.5 h-3 w-3 shrink-0" />
					<span>{selected.address}</span>
				</p>
			{/if}
		</div>

		{#if selected?.status === 'FULL'}
			<p
				class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted/40 p-2.5 text-xs text-danger"
			>
				<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>{t.shelterFullWarning}</span>
			</p>
		{/if}
	</section>

	{#if isShelterOrQueueChosen}
		<!-- Issue #254: Mount Shared Unified Registration Form -->
		<UnifiedRegistrationForm
			channel="public"
			includeVehiclesAssets={false}
			pending={isSubmitting}
			{submitDisabled}
			enableUnassignedPhoto={isUnassigned}
			shelterCode={isUnassigned ? '' : selectedShelterCode}
			shelterName={selected?.name ?? (isUnassigned ? 'ไม่ระบุศูนย์พักพิง' : selectedShelterCode)}
			onsubmit={handleUnifiedSubmit}
			onselectshelter={(code, name) => {
				if (code && selectedShelterCode !== code) {
					selectedShelterCode = code;
					toast.success(`เปลี่ยนศูนย์พักพิงเป็น "${name || code}" เรียบร้อยแล้ว`);
				}
			}}
			submitLabel="ยืนยันการลงทะเบียน"
		>
			{#snippet children({ household })}
				{@const currentDisclaimerGroups = !isUnassigned
					? buildDisclaimerGroups({
							assetDescription: household.assets?.description ?? '',
							petCount: (household.pets ?? []).length,
							vehicleCount: (household.vehicles ?? []).length,
							shelter: shelterPolicy as unknown as ShelterSummary
						})
					: []}
				{#if isUnassigned}
					<section class="mt-2 space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
						<div class="flex items-center gap-2">
							<ShieldAlert class="size-5 text-amber-600 dark:text-amber-400" />
							<h4 class="text-sm font-bold text-foreground">{t.unassignedDisclaimerTitle}</h4>
						</div>
						<p class="text-xs leading-relaxed text-muted-foreground">
							{t.unassignedDisclaimerBody}
						</p>
						<label
							class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-amber-500/30 bg-card p-3.5 shadow-2xs"
						>
							<Checkbox
								id="unassigned-disclaimer-ack"
								checked={disclaimerAcknowledged}
								onCheckedChange={(v) => (disclaimerAcknowledged = v === true)}
								class="mt-0.5 size-4 shrink-0"
							/>
							<span class="text-xs leading-relaxed font-semibold select-none sm:text-sm">
								{t.unassignedDisclaimerAck}
							</span>
						</label>
					</section>
				{:else if currentDisclaimerGroups.length > 0}
					<section class="mt-2 space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
						<div class="flex items-center gap-2">
							<ShieldAlert class="size-5 text-amber-600 dark:text-amber-400" />
							<h4 class="text-sm font-bold text-foreground">
								เงื่อนไขและมาตรการความปลอดภัยของศูนย์พักพิง
							</h4>
						</div>
						<div class="space-y-3">
							{#each currentDisclaimerGroups as group (group.label)}
								<div>
									<h5 class="mb-1 text-xs font-semibold text-foreground">{group.label}</h5>
									<ul class="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
										{#each group.items as item, i (i)}
											<li>{item}</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
						<label
							class="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-amber-500/30 bg-card p-3.5 shadow-2xs"
						>
							<Checkbox
								id="disclaimer-ack"
								checked={disclaimerAcknowledged}
								onCheckedChange={(v) => (disclaimerAcknowledged = v === true)}
								class="mt-0.5 size-4 shrink-0"
							/>
							<span class="text-xs leading-relaxed font-semibold select-none sm:text-sm">
								ข้าพเจ้ารับทราบและยินยอมปฏิบัติตามเงื่อนไขและมาตรการด้านความปลอดภัยของศูนย์พักพิงทุกประการ
							</span>
						</label>
					</section>
				{/if}
				{#if captchaEnabled}
					<p class="text-center text-2xs text-muted-foreground">{t.recaptchaBranding}</p>
				{/if}
			{/snippet}
		</UnifiedRegistrationForm>
	{:else}
		<div class="rounded-2xl border border-dashed border-border/80 bg-card/50 p-8 text-center">
			<MapPin class="mx-auto mb-2 size-8 text-muted-foreground/60" />
			<h4 class="text-sm font-bold text-foreground">กรุณาเลือกศูนย์พักพิง</h4>
			<p class="mt-1 text-xs text-muted-foreground">
				เลือกศูนย์พักพิงที่ท่านต้องการเข้าพัก หรือเลือก "ไม่ระบุศูนย์พักพิง" เพื่อดำเนินการลงทะเบียน
			</p>
		</div>
	{/if}
</div>
