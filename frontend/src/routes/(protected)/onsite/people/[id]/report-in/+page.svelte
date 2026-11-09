<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Lock from '@lucide/svelte/icons/lock';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { UlidReservation } from '$lib/db/ulid-reservation';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { STAFF_REGISTRATION_DESK_I18N } from '$lib/constants/i18n/staff-registration-desk';
	import { ConsentSummary, initialSearchVisible } from '$lib/features/consent';
	import {
		FamilyBatchPrint,
		RegistrationConsentResult,
		RegistrationSaveErrorAlert,
		UnifiedRegistrationForm,
		useEvacuee,
		useEvacuees,
		useHousehold,
		useSubmitFamilyReportIn,
		buildSaveFailureReport,
		householdToUnifiedInput,
		evacueeToUnifiedMember,
		formatPersonName,
		type Evacuee,
		type Household,
		type RegistrationConsent,
		type RegistrationConsentConfig,
		type SaveFailureReport,
		type UnifiedRegistrationInput,
		type UnifiedMemberWithMeta
	} from '$lib/features/people';

	let { data } = $props();

	const td = $derived(getTranslation(STAFF_REGISTRATION_DESK_I18N, langState.current));
	const t = $derived(td.reportIn);

	const evacueeQuery = useEvacuee(() => data.evacueeId);
	const evacuee = $derived(evacueeQuery.data ?? null);

	const householdQuery = useHousehold(
		() => evacuee?.household_id ?? '',
		() => Boolean(evacuee?.household_id)
	);
	const household = $derived(householdQuery.data ?? null);

	const evacueesQuery = useEvacuees();
	const allEvacuees = $derived(evacueesQuery.data ?? []);

	const familyMembers = $derived.by(() => {
		if (!evacuee) return [];
		if (!evacuee.household_id) return [evacuee];
		const members = allEvacuees.filter((e) => e.household_id === evacuee.household_id);
		if (members.length === 0) return [evacuee];
		// Place head first if available, else target evacuee first
		const headId = household?.head_evacuee_id ?? evacuee._id;
		return [...members].sort((a, b) => {
			if (a._id === headId) return -1;
			if (b._id === headId) return 1;
			return 0;
		});
	});

	const initialHousehold = $derived(householdToUnifiedInput(household, evacuee));
	const initialMembers = $derived(
		familyMembers.map((m) => evacueeToUnifiedMember(m, data.evacueeId))
	);

	const staff = $derived(
		authStore.user
			? { name: authStore.user.display_name || authStore.user.name, userId: authStore.user.name }
			: null
	);
	/** FR-41: people who already gave consent keep it and get a read-only summary instead. */
	const consentedMembers = $derived(familyMembers.filter((m) => m.consent));
	const consentConfig = $derived<RegistrationConsentConfig>({
		channel: 'staff',
		staff,
		consentedKeys: consentedMembers.map((m) => m._id),
		initialSearchVisible: initialSearchVisible(
			familyMembers.filter((m) => !m.consent).map((m) => m.privacy)
		)
	});

	const submitReportIn = useSubmitFamilyReportIn();
	// CR-192: when the report-in form was opened — the Station 1 `start` time (plain const: not reactive).
	const formOpenedAt = new Date().toISOString();

	let completed = $state<{
		household: Household;
		members: Evacuee[];
		consentRef: string | null;
	} | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	let reportInReservationKey = $state('');
	let reportInIds = $state<UlidReservation | null>(null);

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

	const alreadyReportedIn = $derived(
		Boolean(
			evacuee &&
			evacuee.current_stay.status !== 'pre_registered' &&
			evacuee.current_stay.status !== 'kiosk_registered'
		)
	);

	async function handleReportIn(
		input: UnifiedRegistrationInput,
		meta?: {
			reportingInMembers: UnifiedMemberWithMeta[];
			allMembers: UnifiedMemberWithMeta[];
			consent: RegistrationConsent | null;
		}
	) {
		if (alreadyReportedIn) return;
		const consent = meta?.consent ?? null;
		const shelterCode = getShelterCode();
		const ctx = {
			shelterCode,
			createdBy: authStore.user?.name ?? 'unknown'
		};

		saveError = null;

		try {
			const members = meta?.allMembers ?? (input.members as UnifiedMemberWithMeta[]);
			const targetHouseholdId =
				evacuee?.household_id || household?._id || input.join_household_id || '';
			const createHousehold = !targetHouseholdId;
			const reservationKey = JSON.stringify({
				householdId: targetHouseholdId,
				createHousehold,
				household: input.household,
				members,
				consentRef: consent?.decision.ref ?? null
			});
			if (!reportInIds || reportInReservationKey !== reservationKey) {
				reportInReservationKey = reservationKey;
				reportInIds = new UlidReservation();
			}
			const result = await submitReportIn.mutateAsync({
				householdId: targetHouseholdId,
				createHousehold,
				household: input.household,
				members,
				ctx,
				ids: reportInIds,
				consent,
				stationStartedAt: formOpenedAt
			});
			saveError = null;
			isDirty = false;
			isNavigatingAfterSave = true;
			completed = { ...result, consentRef: consent?.decision.ref ?? null };
			await focusCompletionHeading();
			toast.success(t.toastSuccess(result.members.length));
		} catch (err) {
			saveError = buildSaveFailureReport(err, {
				summaryTh: t.failSummary,
				shelterCode
			});
			toast.error(t.failToast);
			throw err;
		}
	}

	async function focusCompletionHeading() {
		await tick();
		window.scrollTo({ top: 0, behavior: 'auto' });
		document.documentElement.scrollTo({ top: 0, behavior: 'auto' });
		document.body.scrollTo({ top: 0, behavior: 'auto' });
		document.getElementById('family-batch-print-heading')?.focus({ preventScroll: true });
	}
</script>

<svelte:head>
	<title>
		{t.pageTitle(evacuee ? evacuee.first_name : null)} | SmartShelter
	</title>
</svelte:head>

{#snippet registrationForm(readOnly: boolean)}
	<UnifiedRegistrationForm
		mode="report-in"
		channel="onsite"
		allowHouseholdJoin={!evacuee?.household_id}
		includeVehiclesAssets={true}
		shelterCode={getShelterCode()}
		{initialHousehold}
		{initialMembers}
		{readOnly}
		consent={readOnly ? undefined : consentConfig}
		pending={submitReportIn.isPending}
		onsubmit={handleReportIn}
		onDirtyChange={(dirty) => (isDirty = dirty)}
	/>
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
		<button
			type="button"
			onclick={backToQueue}
			class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<span>{td.common.backToQueue}</span>
		</button>

		<div class="mb-2 flex flex-wrap items-center gap-2">
			<ClipboardList class="size-6 text-primary" />
			<h1 class="text-2xl font-bold md:text-3xl">{t.heading}</h1>
		</div>
		<p class="mb-4 text-sm text-muted-foreground md:mb-6">
			{alreadyReportedIn ? t.introReadOnly : t.introEdit}
		</p>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		{#if evacueeQuery.isPending || (evacuee?.household_id && householdQuery.isPending) || evacueesQuery.isPending}
			<div class="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
				<div
					class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
				></div>
				<p class="text-xs">{t.loading}</p>
			</div>
		{:else if !evacuee}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<AlertTriangle class="size-6" />
				</div>
				<h2 class="text-base font-bold">{t.notFoundTitle}</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					{t.notFoundPrefix} <span class="font-mono">{data.evacueeId}</span>
					{t.notFoundSuffix}
				</p>
				<Button class="mt-4" onclick={backToQueue}>{td.common.backToQueue}</Button>
			</Card.Root>
		{:else if alreadyReportedIn}
			<Card.Root class="border-border bg-card p-6 text-center shadow-sm">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600"
				>
					<Lock class="size-6" />
				</div>
				<h2 class="text-base font-bold">{t.alreadyTitle}</h2>
				<p class="mt-1.5 text-xs text-muted-foreground">
					{t.alreadyBody(evacuee.current_stay.status)}
				</p>
				<Button
					class="mt-4"
					onclick={() => goto(resolve(`/onsite/people/evacuee-profile-view/${evacuee._id}`))}
				>
					{t.goToProfile}
				</Button>
			</Card.Root>
			{@render registrationForm(true)}
		{:else}
			{#if consentedMembers.length > 0}
				<div class="mb-4 grid gap-3 md:grid-cols-2">
					{#each consentedMembers as member (member._id)}
						{#if member.consent}
							<ConsentSummary
								consent={member.consent}
								searchExcluded={member.privacy.search_excluded}
								heading={formatPersonName(member)}
							/>
						{/if}
					{/each}
				</div>
			{/if}
			{@render registrationForm(false)}
		{/if}
	{/if}
</div>
