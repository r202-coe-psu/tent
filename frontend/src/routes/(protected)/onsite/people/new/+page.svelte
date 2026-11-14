<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		FamilyBatchPrint,
		RegistrationConsentResult,
		RegistrationSaveErrorAlert,
		UnifiedRegistrationForm,
		useCreateFamilyRegistration,
		buildSaveFailureReport,
		isRegistrationCompensationIncomplete,
		peopleRepository,
		deriveDuplicateCheckQueries,
		duplicateCheckKey,
		hasFederatedIntakeHits,
		formatPersonName,
		resolveInstantDuplicateAction,
		isIntakeNewRegistrationLocked,
		intakeSearchCopyByLanguage,
		EVACUEE_PAGE_I18N,
		type Evacuee,
		type Household,
		type IntakeNextStation,
		type RegistrationConsent,
		type RegistrationConsentConfig,
		digitsOnly,
		type ScannedCardDuplicate,
		type SaveFailureReport,
		type UnifiedRegistrationInput
	} from '$lib/features/people';
	import {
		formatOpenMemberName,
		unassignedRegistrationRemote
	} from '$lib/features/unassigned-registration';
	import { resolveShelterCode } from '$lib/db/shelter';
	import { UlidReservation } from '$lib/db/ulid-reservation';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';
	import { langState } from '$lib/states/i18n.svelte';
	import { STAFF_REGISTRATION_DESK_I18N } from '$lib/constants/i18n/staff-registration-desk';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const td = $derived(getTranslation(STAFF_REGISTRATION_DESK_I18N, langState.current));
	const tw = $derived(td.walkIn);
	const copy = $derived(intakeSearchCopyByLanguage[langState.current]);
	const createFamily = useCreateFamilyRegistration();
	// CR-192: when the walk-in form was opened — the Station 1 `start` time (plain const: not reactive).
	const formOpenedAt = new Date().toISOString();
	// No 'SH001' fallback here: a walk-in must never be written to a guessed shelter.
	const shelterCode = $derived(resolveShelterCode());

	let completed = $state<{
		household: Household;
		members: Evacuee[];
		consentRef: string | null;
	} | null>(null);
	const staff = $derived(
		authStore.user
			? { name: authStore.user.display_name || authStore.user.name, userId: authStore.user.name }
			: null
	);
	const consentConfig = $derived<RegistrationConsentConfig>({ channel: 'staff', staff });
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	let checkingDuplicate = $state(false);
	let overrideDialogOpen = $state(false);
	let overrideDialogPoolError = $state(false);
	const overrideDialogBody = $derived(
		overrideDialogPoolError ? copy.overridePoolErrorBody : copy.overrideBody
	);
	/** Member cards (display names) whose search hit someone — shown in the override dialog. */
	let overrideMatchedMembers = $state<string[]>([]);
	let overrideConfirmedForKey = '';
	/**
	 * Doc-ID reservation reused while the submitted input is unchanged: a resubmit
	 * after a network failure re-mints the same `_id`s, so CouchDB answers the
	 * already-committed docs with 409 instead of storing a second family.
	 */
	let idReservation: { inputKey: string; ids: UlidReservation } | null = null;

	/** The consent ref is part of the key: a changed consent choice must not replay old ids. */
	function reservationFor(
		input: UnifiedRegistrationInput,
		consent: RegistrationConsent | null
	): UlidReservation {
		const inputKey = JSON.stringify([input, consent?.decision.ref ?? null]);
		if (idReservation?.inputKey !== inputKey) {
			idReservation = { inputKey, ids: new UlidReservation() };
		}
		return idReservation.ids;
	}
	let overrideResolver: ((confirmed: boolean) => void) | null = null;

	/**
	 * Scanned-card duplicate lookup (#1326 D3): the same shelter (Couch) + central unassigned queue
	 * search as the save-time check, for one citizen ID. A hit anywhere wins; with no hit, a failed
	 * source throws so the form can warn instead of reporting "nobody found".
	 */
	async function findScannedCardDuplicate(citizenId: string): Promise<ScannedCardDuplicate | null> {
		const [local, pool] = await Promise.allSettled([
			peopleRepository().searchEvacueesMany([citizenId]),
			unassignedRegistrationRemote.searchOpen(citizenId)
		]);
		if (local.status === 'fulfilled') {
			const evacuee = local.value.get(citizenId)?.[0];
			if (evacuee) {
				const { actionUrl } = resolveInstantDuplicateAction({
					source: 'local',
					id: evacuee._id,
					status: evacuee.current_stay?.status
				});
				return { name: formatPersonName(evacuee), href: actionUrl };
			}
		}
		if (pool.status === 'fulfilled') {
			const hit = pool.value.results[0];
			if (hit && hit.open_members.length > 0) {
				const member =
					hit.open_members.find((m) => digitsOnly(m.person_id?.number) === citizenId) ??
					hit.open_members[0];
				const { actionUrl } = resolveInstantDuplicateAction({
					source: 'unassigned',
					id: hit.id,
					memberIds: hit.open_members.map((m) => m.reserved_evacuee_id)
				});
				return { name: formatOpenMemberName(member), href: actionUrl };
			}
		}
		if (local.status === 'rejected') throw local.reason;
		if (pool.status === 'rejected') throw pool.reason;
		return null;
	}

	/**
	 * Re-runs the CR-115 federated hard anti-dupe search at the actual write
	 * point (not just the Station 1 search-first UI, which is cosmetic-only —
	 * this route is directly URL-reachable and must not skip the lock/override).
	 * Returns true when it's safe to proceed with createFamily.mutateAsync.
	 */
	async function checkForDuplicatesAndMaybeConfirm(
		input: UnifiedRegistrationInput
	): Promise<boolean> {
		// Every member card, not just members[0] — companions may already be registered.
		const queries = deriveDuplicateCheckQueries(input.members);
		if (queries.length === 0) return true;
		const key = duplicateCheckKey(queries);
		if (overrideConfirmedForKey === key) return true;

		checkingDuplicate = true;
		let localHits: Map<string, Evacuee[]>;
		try {
			localHits = await peopleRepository().searchEvacueesMany(queries.map((q) => q.query));
		} catch {
			checkingDuplicate = false;
			toast.error(tw.duplicateCheckFailed);
			return false;
		}

		const poolResults = await Promise.allSettled(
			queries.map((q) => unassignedRegistrationRemote.searchOpen(q.query))
		);
		checkingDuplicate = false;
		const poolError = poolResults.some((r) => r.status === 'rejected');

		// Plain array, not a Set: local to this call, never reactive.
		const matchedIndexes: number[] = [];
		queries.forEach((q, i) => {
			const pool = poolResults[i];
			const poolCount = pool.status === 'fulfilled' ? pool.value.results.length : 0;
			if (hasFederatedIntakeHits(localHits.get(q.query)?.length ?? 0, poolCount)) {
				for (const index of q.memberIndexes) {
					if (!matchedIndexes.includes(index)) matchedIndexes.push(index);
				}
			}
		});

		const locked = isIntakeNewRegistrationLocked({
			hasSearched: true,
			poolError,
			hasFederatedHits: matchedIndexes.length > 0,
			overrideConfirmed: false
		});
		if (!locked) return true;

		overrideMatchedMembers = matchedIndexes
			.toSorted((a, b) => a - b)
			.map((index) => {
				const member = input.members[index];
				const name = `${member.first_name} ${member.last_name ?? ''}`.trim();
				return tw.matchedMember(index + 1, name);
			});
		overrideDialogPoolError = poolError;
		overrideDialogOpen = true;
		return new Promise<boolean>((resolve) => {
			overrideResolver = (confirmed) => {
				if (confirmed) overrideConfirmedForKey = key;
				resolve(confirmed);
			};
		});
	}

	function confirmOverride() {
		overrideDialogOpen = false;
		overrideResolver?.(true);
		overrideResolver = null;
	}

	// Covers Cancel button, Escape, and backdrop dismiss uniformly — any close
	// without an explicit confirm resolves the pending check as "not overridden".
	$effect(() => {
		if (!overrideDialogOpen && overrideResolver) {
			overrideResolver(false);
			overrideResolver = null;
		}
	});

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completed) return;
		if (isDirty && !confirm(td.common.leaveConfirm)) {
			nav.cancel();
		}
	});

	async function handleRegister(
		input: UnifiedRegistrationInput,
		meta?: { consent: RegistrationConsent | null }
	) {
		const consent = meta?.consent ?? null;
		const canProceed = await checkForDuplicatesAndMaybeConfirm(input);
		if (!canProceed) {
			// Silently abort — caller (UnifiedRegistrationForm) swallows a thrown
			// error and, importantly, does NOT clear the dirty/unsaved-changes
			// state, so declining the override just returns to the filled form.
			throw new Error('registration cancelled: unresolved duplicate hit');
		}

		const createdBy = authStore.user?.name;
		if (!shelterCode || !createdBy) {
			toast.error(tw.noShelterToast);
			throw new Error('registration blocked: no active shelter or user');
		}
		const ctx = { shelterCode, createdBy };

		saveError = null;

		try {
			const result = await createFamily.mutateAsync({
				input,
				ctx,
				channel: 'onsite',
				ids: reservationFor(input, consent),
				consent,
				stationStartedAt: formOpenedAt
			});
			saveError = null;
			isDirty = false;
			isNavigatingAfterSave = true;
			completed = { ...result, consentRef: consent?.decision.ref ?? null };
			await focusCompletionHeading();
			toast.success(tw.registered(result.members.length));
		} catch (err) {
			const partial = isRegistrationCompensationIncomplete(err);
			saveError = buildSaveFailureReport(err, {
				summaryTh: t.saveErrorSummary,
				shelterCode: ctx.shelterCode,
				rollbackNote: partial
					? tw.partialRollbackNote
					: 'compensated: deleted household + members created in this submit when possible'
			});
			if (partial) {
				toast.warning(tw.partialToast);
			} else {
				toast.error(t.toastSaveFailed);
			}
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

	function backToQueue() {
		isNavigatingAfterSave = true;
		completed = null;
		goto(resolve('/onsite/people'));
	}

	/** Single person → open their station form directly; a family → that station's queue. */
	function goToNextStation(station: IntakeNextStation) {
		if (!completed) return;
		isNavigatingAfterSave = true;
		const only = completed.members.length === 1 ? completed.members[0] : null;
		if (station === 'medical') {
			if (only) goto(resolve(`/onsite/medical-screening/${only._id}`));
			else goto(resolve('/onsite/medical-screening'));
			return;
		}
		if (only) goto(resolve(`/onsite/zoning/${only._id}`));
		else goto(resolve('/onsite/zoning'));
	}

	/** Fresh form in place: the `{#if completed}` swap remounts UnifiedRegistrationForm. */
	function registerAnother() {
		completed = null;
		saveError = null;
		isDirty = false;
		isNavigatingAfterSave = false;
		idReservation = null;
		overrideConfirmedForKey = '';
		window.scrollTo({ top: 0 });
	}
</script>

<svelte:head>
	<title>{tw.pageTitle}</title>
</svelte:head>

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
			onNextStation={goToNextStation}
			onRegisterAnother={registerAnother}
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

		<h1 class="mb-2 text-2xl font-bold md:mb-1 md:text-3xl">{tw.heading}</h1>
		<p class="mb-4 text-sm text-muted-foreground md:mb-6">
			{tw.intro}
		</p>

		{#if !shelterCode}
			<div
				role="alert"
				class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
			>
				{tw.noShelterAlert}
			</div>
		{:else}
			<p class="mb-4 text-sm">
				{tw.saveInto} <span class="font-semibold">{shelterCode}</span>
			</p>

			{#if saveError}
				<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
			{/if}

			<UnifiedRegistrationForm
				channel="onsite"
				includeVehiclesAssets={true}
				{shelterCode}
				pending={createFamily.isPending || checkingDuplicate}
				consent={consentConfig}
				onsubmit={handleRegister}
				onDirtyChange={(dirty) => (isDirty = dirty)}
				{findScannedCardDuplicate}
				scannerEnabled
			/>
		{/if}
	{/if}
</div>

<AlertDialog.Root bind:open={overrideDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{copy.overrideTitle}</AlertDialog.Title>
			<AlertDialog.Description>{overrideDialogBody}</AlertDialog.Description>
		</AlertDialog.Header>
		{#if overrideMatchedMembers.length > 0}
			<div class="text-sm">
				<p class="font-medium">{tw.possibleDuplicates}</p>
				<ul class="mt-1 list-disc pl-5">
					{#each overrideMatchedMembers as label (label)}
						<li>{label}</li>
					{/each}
				</ul>
			</div>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{copy.overrideCancel}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmOverride}>{copy.overrideConfirm}</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
