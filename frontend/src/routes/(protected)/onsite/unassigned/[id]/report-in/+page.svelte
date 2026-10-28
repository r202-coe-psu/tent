<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { ConsentSummary, initialSearchVisible } from '$lib/features/consent';
	import {
		FamilyBatchPrint,
		RegistrationConsentResult,
		RegistrationSaveErrorAlert,
		UnifiedRegistrationForm,
		peopleRepository,
		useHousehold,
		useSubmitFamilyReportIn,
		buildSaveFailureReport,
		formatPersonName,
		type Evacuee,
		type Household,
		type RegistrationConsent,
		type RegistrationConsentConfig,
		type SaveFailureReport,
		type UnifiedRegistrationInput,
		type UnifiedMemberWithMeta
	} from '$lib/features/people';
	import {
		formatOpenPetLabel,
		petsLeftBehind,
		totalPetCount,
		unassignedHouseholdToUnifiedInput,
		unassignedMemberToUnifiedMember,
		unassignedPhotoUrl,
		useClaimUnassignedRegistration,
		useUnassignedRegistrationReview
	} from '$lib/features/unassigned-registration';

	let { data } = $props();

	const reviewQuery = useUnassignedRegistrationReview(() => data.registrationId);
	const review = $derived(reviewQuery.data ?? null);

	const openMembers = $derived(
		(review?.open_members ?? []).filter((m) => data.memberIds.includes(m.reserved_evacuee_id))
	);
	let claimEveryOpenPet = $state(false);
	const selectedPetIds = $derived(
		claimEveryOpenPet ? (review?.open_pets ?? []).map((pet) => pet.pet_id) : data.petIds
	);
	const openPets = $derived(
		(review?.open_pets ?? []).filter((p) => selectedPetIds.includes(p.pet_id))
	);
	const leftBehindPets = $derived(petsLeftBehind(review?.open_pets ?? [], selectedPetIds));
	const leftBehindCount = $derived(totalPetCount(leftBehindPets));

	/** No member ticked at all — pets-only claim (FR-PUF-16), no Report-in step. */
	const isPetsOnly = $derived(data.memberIds.length === 0);
	/** Ticked members no longer open (claimed elsewhere between dialog and page load). */
	const staleMemberSelection = $derived(Boolean(review) && !isPetsOnly && openMembers.length === 0);

	const existingHouseholdQuery = useHousehold(
		() => review?.reserved_household_id ?? '',
		() => Boolean(review?.reserved_household_id)
	);
	const existingHousehold = $derived(existingHouseholdQuery.data ?? null);

	const initialHousehold = $derived(review ? unassignedHouseholdToUnifiedInput(review) : null);
	const initialMembers = $derived(openMembers.map(unassignedMemberToUnifiedMember));

	const claimMutation = useClaimUnassignedRegistration();
	const submitReportIn = useSubmitFamilyReportIn();
	// CR-192: when the report-in form was opened — the Station 1 `start` time (plain const: not reactive).
	const formOpenedAt = new Date().toISOString();

	const staff = $derived(
		authStore.user
			? { name: authStore.user.display_name || authStore.user.name, userId: authStore.user.name }
			: null
	);
	/** FR-41: members who consented on the public form keep it and get a read-only summary. */
	const consentedMembers = $derived(
		openMembers.flatMap((member) => (member.consent ? [{ member, consent: member.consent }] : []))
	);
	const consentConfig = $derived<RegistrationConsentConfig>({
		channel: 'staff',
		staff,
		consentedKeys: consentedMembers.map(({ member }) => member.reserved_evacuee_id),
		initialSearchVisible: initialSearchVisible(
			openMembers
				.filter((m) => !m.consent)
				.map((m) => ({ search_excluded: m.search_excluded ?? false }))
		)
	});

	let completed = $state<{
		household: Household;
		members: Evacuee[];
		consentRef: string | null;
	} | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	/** Set once claim succeeds — a retry after a Report-in failure must not claim again (FR-PUF-15). */
	let claimedHouseholdId = $state<string | null>(null);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completed) return;
		if (isDirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
			nav.cancel();
		}
	});

	function backToQueue() {
		isNavigatingAfterSave = true;
		completed = null;
		goto(resolve('/onsite/people'));
	}

	function claimPayload() {
		return {
			registrationId: data.registrationId,
			payload: {
				...(data.memberIds.length > 0 ? { member_ids: data.memberIds } : {}),
				...(selectedPetIds.length > 0 ? { pet_ids: selectedPetIds } : {}),
				...(data.shelterCode ? { shelter_code: data.shelterCode } : {})
			}
		};
	}

	async function handleConfirm(
		input: UnifiedRegistrationInput,
		meta?: {
			reportingInMembers: UnifiedMemberWithMeta[];
			allMembers: UnifiedMemberWithMeta[];
			consent: RegistrationConsent | null;
		}
	) {
		saveError = null;
		const consent = meta?.consent ?? null;
		try {
			if (!claimedHouseholdId) {
				const claimResult = await claimMutation.mutateAsync(claimPayload());
				claimedHouseholdId = claimResult.household_id;
			}

			// Claim's Couch birth already wrote the correct `pets[]` — always source it fresh
			// here rather than resubmitting the review form's own (pre-claim) copy, or a
			// stale/incomplete pets array would silently overwrite what claim just birthed.
			const freshHousehold = await peopleRepository().getHousehold(claimedHouseholdId);

			const result = await submitReportIn.mutateAsync({
				householdId: claimedHouseholdId,
				household: {
					...input.household,
					pets: freshHousehold?.pets ?? input.household.pets
				},
				members: meta?.allMembers ?? (input.members as UnifiedMemberWithMeta[]),
				ctx: {
					shelterCode: data.shelterCode ?? getShelterCode(),
					createdBy: authStore.user?.name ?? 'unknown'
				},
				consent,
				stationStartedAt: formOpenedAt
			});
			isDirty = false;
			isNavigatingAfterSave = true;
			completed = { ...result, consentRef: consent?.decision.ref ?? null };
			toast.success(`รับเข้าศูนย์สำเร็จ ${result.members.length} คน`);
		} catch (err) {
			saveError = !claimedHouseholdId
				? buildSaveFailureReport(err, { summaryTh: 'รับเข้าศูนย์ไม่สำเร็จ' })
				: buildSaveFailureReport(err, {
						summaryTh: 'บันทึกการรายงานตัวไม่สำเร็จ',
						rollbackNote:
							'รับเข้าศูนย์แล้ว — กดยืนยันอีกครั้งเพื่อบันทึกการรายงานตัว หรือไปที่หน้ารายงานตัวของผู้ประสบภัยแต่ละคนแทน'
					});
			toast.error('ยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
			throw err;
		}
	}

	let isConfirmingPetsOnly = $state(false);

	async function handleConfirmPetsOnly() {
		saveError = null;
		isConfirmingPetsOnly = true;
		try {
			const result = await claimMutation.mutateAsync(claimPayload());
			isNavigatingAfterSave = true;
			toast.success(`รับเข้าศูนย์ ${result.claimed_pets.length} สัตว์สำเร็จ`);
			await goto(resolve('/onsite/people'));
		} catch (err) {
			saveError = buildSaveFailureReport(err, { summaryTh: 'รับเข้าศูนย์ไม่สำเร็จ' });
			toast.error('รับเข้าศูนย์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
		} finally {
			isConfirmingPetsOnly = false;
		}
	}
</script>

<svelte:head>
	<title>ตรวจสอบก่อนรับเข้าศูนย์ | SmartShelter</title>
</svelte:head>

{#snippet backLink()}
	<button
		type="button"
		onclick={backToQueue}
		class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		<span>กลับคิวทะเบียน</span>
	</button>
{/snippet}

{#snippet leftBehindWarning()}
	{#if leftBehindPets.length > 0}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-2xs" role="status">
			<div class="flex items-start gap-3">
				<AlertTriangle class="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<h2 class="text-sm font-bold text-amber-900">
						ยังมีสัตว์เลี้ยง {leftBehindCount} ตัวที่ไม่ได้เลือก
					</h2>
					<p class="mt-1 text-xs text-amber-900">
						ถ้ารับเข้าศูนย์ตอนนี้ สัตว์เลี้ยงด้านล่างจะค้างอยู่ในคิวกลาง
						และจะไม่ปรากฏในข้อมูลครัวเรือนที่สถานี 1
					</p>
					<ul class="mt-2 space-y-1">
						{#each leftBehindPets as pet (pet.pet_id)}
							<li class="text-xs font-medium text-amber-900">
								{formatOpenPetLabel(pet)}{pet.has_cage ? ' · มีกรง' : ''}
							</li>
						{/each}
					</ul>
					<Button
						variant="outline"
						class="mt-3 min-h-11 w-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100 sm:w-auto"
						onclick={() => (claimEveryOpenPet = true)}
					>
						<PawPrint class="size-4" aria-hidden="true" />
						เพิ่มสัตว์เลี้ยงที่เหลือเข้ารายการนี้
					</Button>
				</div>
			</div>
		</div>
	{/if}
{/snippet}

<div class="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6 xl:max-w-7xl">
	{#if completed}
		{#if completed.consentRef}
			<RegistrationConsentResult
				members={completed.members}
				consentRef={completed.consentRef}
				{staff}
			/>
		{/if}
		<FamilyBatchPrint
			household={completed.household}
			members={completed.members}
			onDone={backToQueue}
		/>
	{:else}
		{@render backLink()}

		<div class="mb-2 flex flex-wrap items-center gap-2">
			<ClipboardList class="size-6 text-primary" />
			<h1 class="text-2xl font-bold md:text-3xl">ตรวจสอบก่อนรับเข้าศูนย์</h1>
			<Badge variant="outline">Station 1 · Review</Badge>
		</div>
		<p class="mb-4 text-sm text-muted-foreground md:mb-6">
			ยังไม่มีการรับเข้าศูนย์ — ตรวจสอบข้อมูลด้านล่างแล้วกดยืนยัน จึงจะสร้าง Evacuee
			และรับเข้าศูนย์จริง
		</p>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		{#if reviewQuery.isPending}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
				<div
					class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
				></div>
				<p class="text-xs">กำลังโหลดข้อมูลจากคิวกลาง...</p>
			</div>
		{:else if reviewQuery.isError || !review}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">ไม่พบรายการนี้ในคิวกลาง</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					รายการอาจถูกรับเข้าศูนย์ไปแล้ว หรือถูกยกเลิก — กลับไปค้นหาใหม่อีกครั้ง
				</p>
				<Button class="mt-4" onclick={backToQueue}>กลับคิวทะเบียน</Button>
			</Card.Root>
		{:else if staleMemberSelection}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">สมาชิกที่เลือกไม่ว่างแล้ว</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					สมาชิกที่ติ๊กไว้ถูกรับเข้าศูนย์อื่นไปแล้วระหว่างที่เปิดหน้านี้ค้างไว้ —
					กลับไปค้นหาใหม่อีกครั้ง
				</p>
				<Button class="mt-4" onclick={backToQueue}>กลับคิวทะเบียน</Button>
			</Card.Root>
		{:else if isPetsOnly}
			<Card.Root class="border-border bg-card p-6 shadow-sm">
				<div class="mb-3 flex items-center gap-2">
					<PawPrint class="size-5 text-primary" />
					<h2 class="text-base font-bold">สัตว์เลี้ยงที่จะรับเข้าศูนย์</h2>
				</div>
				{#if existingHousehold?.pets && existingHousehold.pets.length > 0}
					<p class="mb-3 text-xs text-muted-foreground">
						ครัวเรือนนี้อยู่ในศูนย์แล้ว ({existingHousehold.pets.length} สัตว์เดิม) — รายการด้านล่างจะถูกเพิ่มเข้าไป
					</p>
				{/if}
				<ul class="space-y-2">
					{#each openPets as pet (pet.pet_id)}
						<li
							class="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2"
						>
							{#if unassignedPhotoUrl(pet.image_url)}
								<img
									src={unassignedPhotoUrl(pet.image_url)}
									alt=""
									class="size-10 shrink-0 rounded-lg object-cover"
								/>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="font-medium text-slate-900">{formatOpenPetLabel(pet)}</p>
								{#if pet.has_cage}
									<p class="text-xs text-muted-foreground">มีกรง</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				<Button class="mt-4 w-full" disabled={isConfirmingPetsOnly} onclick={handleConfirmPetsOnly}>
					{isConfirmingPetsOnly ? 'กำลังรับเข้าศูนย์...' : 'ยืนยันรับเข้าศูนย์'}
				</Button>
			</Card.Root>
			{@render leftBehindWarning()}
		{:else if initialHousehold}
			{@render leftBehindWarning()}
			{#if openPets.length > 0}
				<Card.Root class="mb-4 border-border bg-card p-4 shadow-sm">
					<div class="mb-2 flex items-center gap-2">
						<PawPrint class="size-4 text-primary" />
						<h2 class="text-sm font-bold">สัตว์เลี้ยงที่จะรับเข้าศูนย์พร้อมกัน</h2>
					</div>
					<ul class="space-y-1">
						{#each openPets as pet (pet.pet_id)}
							<li class="text-xs text-muted-foreground">
								{formatOpenPetLabel(pet)}{pet.has_cage ? ' · มีกรง' : ''}
							</li>
						{/each}
					</ul>
				</Card.Root>
			{/if}
			{#if consentedMembers.length > 0}
				<div class="mb-4 grid gap-3 md:grid-cols-2">
					{#each consentedMembers as { member, consent } (member.reserved_evacuee_id)}
						<ConsentSummary
							{consent}
							searchExcluded={member.search_excluded ?? false}
							heading={formatPersonName(member)}
						/>
					{/each}
				</div>
			{/if}
			<UnifiedRegistrationForm
				mode="report-in"
				channel="onsite"
				includeVehiclesAssets={true}
				showPetsSummary={false}
				shelterCode={data.shelterCode ?? getShelterCode()}
				{initialHousehold}
				{initialMembers}
				consent={consentConfig}
				pending={claimMutation.isPending || submitReportIn.isPending}
				onsubmit={handleConfirm}
				onDirtyChange={(dirty) => (isDirty = dirty)}
			/>
		{/if}
	{/if}
</div>
