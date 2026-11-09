<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { authStore } from '$lib/stores/auth.svelte';
	import { ValidationError } from '$lib/utils/errors';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { STAFF_REGISTRATION_DESK_I18N } from '$lib/constants/i18n/staff-registration-desk';
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
		type PetGroup,
		type RegistrationConsent,
		type RegistrationConsentConfig,
		type SaveFailureReport,
		type UnifiedRegistrationInput,
		type UnifiedMemberWithMeta
	} from '$lib/features/people';
	import {
		claimedPetSummaries,
		formatOpenPetLabel,
		countPetGroups,
		petsForReportIn,
		petsLeftBehind,
		petsOverCapAfterClaim,
		petsOverCapForConfirm,
		totalOpenPetCount,
		unassignedHouseholdToUnifiedInput,
		unassignedSearchCopyByLanguage,
		unassignedMemberToUnifiedMember,
		unassignedPhotoUrl,
		useClaimUnassignedRegistration,
		useUnassignedRegistrationReview,
		type PetCapCheck
	} from '$lib/features/unassigned-registration';

	let { data } = $props();

	const lang = $derived(langState.current);
	const td = $derived(getTranslation(STAFF_REGISTRATION_DESK_I18N, lang));
	const t = $derived(td.unassigned);
	const hasCageSuffix = $derived(` · ${unassignedSearchCopyByLanguage[lang].hasCage}`);

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
	const leftBehindCount = $derived(totalOpenPetCount(leftBehindPets));
	const originallyLeftBehind = $derived(petsLeftBehind(review?.open_pets ?? [], data.petIds));

	/** No member ticked at all — pets-only claim (FR-PUF-16), no Report-in step. */
	const isPetsOnly = $derived(data.memberIds.length === 0);
	/** Ticked members no longer open (claimed elsewhere between dialog and page load). */
	const staleMemberSelection = $derived(Boolean(review) && !isPetsOnly && openMembers.length === 0);

	const existingHouseholdQuery = useHousehold(
		() => review?.reserved_household_id ?? '',
		() => Boolean(review?.reserved_household_id)
	);
	const existingHousehold = $derived(existingHouseholdQuery.data ?? null);
	let householdPetsAtClaim = $state<PetGroup[] | null>(null);
	const householdPetsBeforeClaim = $derived(householdPetsAtClaim ?? existingHousehold?.pets ?? []);
	const householdPetCountBeforeClaim = $derived(countPetGroups(householdPetsBeforeClaim));
	const recordedPets = $derived([
		...claimedPetSummaries(householdPetsBeforeClaim, lang),
		...claimedPetSummaries(openPets, lang)
	]);

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
	let petsWrittenByClaim = $state<PetGroup[] | null>(null);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completed) return;
		if (isDirty && !confirm(td.common.leaveConfirm)) {
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

	function petCapError(check: PetCapCheck, advice: string) {
		return new ValidationError(t.petCapError(check.total, check.cap, check.over, advice));
	}

	async function petsOnHouseholdBeforeClaim(): Promise<PetGroup[]> {
		if (householdPetsAtClaim) return householdPetsAtClaim;
		if (existingHousehold) return existingHousehold.pets ?? [];
		const householdId = review?.reserved_household_id;
		if (!householdId) return [];
		const fresh = await peopleRepository().getHousehold(householdId);
		return fresh?.pets ?? [];
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
				const petsBefore = await petsOnHouseholdBeforeClaim();
				const petsCheck = petsOverCapForConfirm(
					petsBefore,
					totalOpenPetCount(openPets),
					input.household.pets
				);
				if (petsCheck.over > 0) {
					throw petCapError(petsCheck, t.adviceReduceOrPool);
				}
				householdPetsAtClaim = petsBefore;
				const claimResult = await claimMutation.mutateAsync(claimPayload());
				claimedHouseholdId = claimResult.household_id;
			}

			// Claim's Couch birth already wrote its own `pets[]` — read them once, here, rather
			// than resubmitting the review form's own (pre-claim) copy. Snapshotting instead of
			// re-reading keeps a retry after a partial write from appending the typed rows twice.
			if (petsWrittenByClaim === null) {
				const freshHousehold = await peopleRepository().getHousehold(claimedHouseholdId);
				if (!freshHousehold) {
					throw new Error(t.readHouseholdFailed);
				}
				petsWrittenByClaim = freshHousehold.pets ?? [];
			}

			const mergedPets = petsForReportIn(petsWrittenByClaim, input.household.pets);
			const mergedCheck = petsOverCapAfterClaim(mergedPets);
			if (mergedCheck.over > 0) {
				throw petCapError(mergedCheck, t.adviceReduceRetry);
			}

			const result = await submitReportIn.mutateAsync({
				householdId: claimedHouseholdId,
				household: { ...input.household, pets: mergedPets },
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
			toast.success(t.claimed(result.members.length));
		} catch (err) {
			if (err instanceof ValidationError) {
				saveError = buildSaveFailureReport(err, {
					summaryTh: t.confirmCapSummary
				});
				toast.error(t.petCapToast);
				throw err;
			}
			saveError = !claimedHouseholdId
				? buildSaveFailureReport(err, { summaryTh: t.claimFailedSummary })
				: buildSaveFailureReport(err, {
						summaryTh: t.reportInFailedSummary,
						rollbackNote: t.reportInFailedRollback
					});
			toast.error(t.confirmFailedToast);
			throw err;
		}
	}

	let isConfirmingPetsOnly = $state(false);

	async function handleConfirmPetsOnly() {
		saveError = null;
		isConfirmingPetsOnly = true;
		try {
			const petsCheck = petsOverCapForConfirm(
				await petsOnHouseholdBeforeClaim(),
				totalOpenPetCount(openPets),
				[]
			);
			if (petsCheck.over > 0) {
				throw petCapError(petsCheck, t.adviceBackToQueue);
			}
			const result = await claimMutation.mutateAsync(claimPayload());
			isNavigatingAfterSave = true;
			toast.success(t.petsClaimed(result.claimed_pets.length));
			await goto(resolve('/onsite/people'));
		} catch (err) {
			if (err instanceof ValidationError) {
				saveError = buildSaveFailureReport(err, {
					summaryTh: t.petsCapSummary
				});
				toast.error(t.petCapToast);
			} else {
				saveError = buildSaveFailureReport(err, { summaryTh: t.claimFailedSummary });
				toast.error(t.claimFailedToast);
			}
		} finally {
			isConfirmingPetsOnly = false;
		}
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

{#snippet backLink()}
	<button
		type="button"
		onclick={backToQueue}
		class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		<span>{td.common.backToQueue}</span>
	</button>
{/snippet}

{#snippet claimAllUndo()}
	{#if claimEveryOpenPet && !claimedHouseholdId && originallyLeftBehind.length > 0}
		<button
			type="button"
			onclick={() => (claimEveryOpenPet = false)}
			class="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
		>
			<Undo2 class="size-3.5" aria-hidden="true" />
			{t.undoClaimAll}
		</button>
	{/if}
{/snippet}

{#snippet leftBehindWarning()}
	{#if leftBehindPets.length > 0}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-2xs" role="status">
			<div class="flex items-start gap-3">
				<AlertTriangle class="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<h2 class="text-sm font-bold text-amber-900">
						{claimedHouseholdId
							? t.leftBehindClaimedTitle(leftBehindCount)
							: t.leftBehindTitle(leftBehindCount)}
					</h2>
					<p class="mt-1 text-xs text-amber-900">
						{claimedHouseholdId ? t.leftBehindClaimedBody : t.leftBehindBody}
					</p>
					<ul class="mt-2 space-y-1">
						{#each leftBehindPets as pet (pet.pet_id)}
							<li class="text-xs font-medium text-amber-900">
								{formatOpenPetLabel(pet, lang)}{pet.has_cage ? hasCageSuffix : ''}
							</li>
						{/each}
					</ul>
					{#if !claimedHouseholdId}
						<Button
							variant="outline"
							class="mt-3 min-h-11 w-full border-amber-300 bg-white text-amber-900 hover:bg-amber-100 sm:w-auto"
							onclick={() => (claimEveryOpenPet = true)}
						>
							<PawPrint class="size-4" aria-hidden="true" />
							{t.addRemainingPets}
						</Button>
					{/if}
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
			<h1 class="text-2xl font-bold md:text-3xl">{t.heading}</h1>
			<Badge variant="outline">Station 1 · Review</Badge>
		</div>
		<p class="mb-4 text-sm text-muted-foreground md:mb-6">
			{t.intro}
		</p>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		{#if reviewQuery.isPending}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
				<div
					class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
				></div>
				<p class="text-xs">{t.loading}</p>
			</div>
		{:else if reviewQuery.isError || !review}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">{t.notFoundTitle}</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					{t.notFoundBody}
				</p>
				<Button class="mt-4" onclick={backToQueue}>{td.common.backToQueue}</Button>
			</Card.Root>
		{:else if staleMemberSelection}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">{t.staleTitle}</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					{t.staleBody}
				</p>
				<Button class="mt-4" onclick={backToQueue}>{td.common.backToQueue}</Button>
			</Card.Root>
		{:else if isPetsOnly}
			<Card.Root class="border-border bg-card p-6 shadow-sm">
				<div class="mb-3 flex items-center gap-2">
					<PawPrint class="size-5 text-primary" />
					<h2 class="text-base font-bold">{t.petsToClaimTitle}</h2>
				</div>
				{#if householdPetCountBeforeClaim > 0}
					<p class="mb-3 text-xs text-muted-foreground">
						{t.householdAlreadyHere(householdPetCountBeforeClaim)}
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
								<p class="font-medium text-slate-900">{formatOpenPetLabel(pet, lang)}</p>
								{#if pet.has_cage}
									<p class="text-xs text-muted-foreground">
										{unassignedSearchCopyByLanguage[lang].hasCage}
									</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				{@render claimAllUndo()}
				<Button class="mt-4 w-full" disabled={isConfirmingPetsOnly} onclick={handleConfirmPetsOnly}>
					{isConfirmingPetsOnly ? t.confirming : t.confirmClaim}
				</Button>
			</Card.Root>
			{@render leftBehindWarning()}
		{:else if initialHousehold}
			{@render leftBehindWarning()}
			{#if openPets.length > 0}
				<Card.Root class="mb-4 border-border bg-card p-4 shadow-sm">
					<div class="mb-2 flex items-center gap-2">
						<PawPrint class="size-4 text-primary" />
						<h2 class="text-sm font-bold">{t.petsAlongsideTitle}</h2>
					</div>
					<ul class="space-y-1">
						{#each openPets as pet (pet.pet_id)}
							<li class="text-xs text-muted-foreground">
								{formatOpenPetLabel(pet, lang)}{pet.has_cage ? hasCageSuffix : ''}
							</li>
						{/each}
					</ul>
					{@render claimAllUndo()}
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
				claimedPets={recordedPets}
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
