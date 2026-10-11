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
		RegistrationSaveErrorAlert,
		UnifiedRegistrationForm,
		useCreateFamilyRegistration,
		buildSaveFailureReport,
		isRegistrationCompensationIncomplete,
		peopleRepository,
		deriveDuplicateCheckQueries,
		duplicateCheckKey,
		hasFederatedIntakeHits,
		isIntakeNewRegistrationLocked,
		OVERRIDE_NEW_REG_TITLE,
		OVERRIDE_NEW_REG_BODY,
		OVERRIDE_NEW_REG_POOL_ERROR_BODY,
		OVERRIDE_NEW_REG_CONFIRM,
		OVERRIDE_NEW_REG_CANCEL,
		EVACUEE_PAGE_I18N,
		type Evacuee,
		type Household,
		type IntakeNextStation,
		type SaveFailureReport,
		type UnifiedRegistrationInput
	} from '$lib/features/people';
	import { unassignedRegistrationRemote } from '$lib/features/unassigned-registration';
	import { resolveShelterCode } from '$lib/db/shelter';
	import { UlidReservation } from '$lib/db/ulid-reservation';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const createFamily = useCreateFamilyRegistration();
	// No 'SH001' fallback here: a walk-in must never be written to a guessed shelter.
	const shelterCode = $derived(resolveShelterCode());

	let completed = $state<{ household: Household; members: Evacuee[] } | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	let checkingDuplicate = $state(false);
	let overrideDialogOpen = $state(false);
	let overrideDialogBody = $state(OVERRIDE_NEW_REG_BODY);
	/** Member cards (display names) whose search hit someone — shown in the override dialog. */
	let overrideMatchedMembers = $state<string[]>([]);
	let overrideConfirmedForKey = '';
	/**
	 * Doc-ID reservation reused while the submitted input is unchanged: a resubmit
	 * after a network failure re-mints the same `_id`s, so CouchDB answers the
	 * already-committed docs with 409 instead of storing a second family.
	 */
	let idReservation: { inputKey: string; ids: UlidReservation } | null = null;

	function reservationFor(input: UnifiedRegistrationInput): UlidReservation {
		const inputKey = JSON.stringify(input);
		if (idReservation?.inputKey !== inputKey) {
			idReservation = { inputKey, ids: new UlidReservation() };
		}
		return idReservation.ids;
	}
	let overrideResolver: ((confirmed: boolean) => void) | null = null;

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
			toast.error('ตรวจสอบข้อมูลซ้ำไม่ได้ ลองบันทึกใหม่อีกครั้ง');
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
				return `สมาชิกคนที่ ${index + 1}${name ? ` — ${name}` : ''}`;
			});
		overrideDialogBody = poolError ? OVERRIDE_NEW_REG_POOL_ERROR_BODY : OVERRIDE_NEW_REG_BODY;
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
		if (isDirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
			nav.cancel();
		}
	});

	async function handleRegister(input: UnifiedRegistrationInput) {
		const canProceed = await checkForDuplicatesAndMaybeConfirm(input);
		if (!canProceed) {
			// Silently abort — caller (UnifiedRegistrationForm) swallows a thrown
			// error and, importantly, does NOT clear the dirty/unsaved-changes
			// state, so declining the override just returns to the filled form.
			throw new Error('registration cancelled: unresolved duplicate hit');
		}

		const createdBy = authStore.user?.name;
		if (!shelterCode || !createdBy) {
			toast.error('ยังไม่ได้เลือกศูนย์พักพิง — เลือกศูนย์ก่อนลงทะเบียน');
			throw new Error('registration blocked: no active shelter or user');
		}
		const ctx = { shelterCode, createdBy };

		saveError = null;

		try {
			const result = await createFamily.mutateAsync({
				input,
				ctx,
				channel: 'onsite',
				ids: reservationFor(input)
			});
			saveError = null;
			isDirty = false;
			isNavigatingAfterSave = true;
			completed = result;
			await focusCompletionHeading();
			toast.success(`ลงทะเบียนครอบครัว ${result.members.length} คน สำเร็จ`);
		} catch (err) {
			const partial = isRegistrationCompensationIncomplete(err);
			saveError = buildSaveFailureReport(err, {
				summaryTh: t.saveErrorSummary,
				shelterCode: ctx.shelterCode,
				rollbackNote: partial
					? 'ยกเลิกข้อมูลที่บันทึกไปแล้วได้ไม่ครบ — กดบันทึกซ้ำได้โดยไม่ต้องแก้ข้อมูล (ระบบจะไม่สร้างซ้ำ) ถ้าแก้ข้อมูลแล้ว ให้ค้นหาชื่อในคิวทะเบียนก่อน'
					: 'compensated: deleted household + members created in this submit when possible'
			});
			if (partial) {
				toast.warning('ข้อมูลอาจถูกบันทึกไปบางส่วน — กดบันทึกซ้ำได้โดยไม่ต้องแก้ข้อมูล');
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
	<title>ลงทะเบียนครอบครัว | SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6 xl:max-w-7xl">
	{#if completed}
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
			<span>กลับคิวทะเบียน</span>
		</button>

		<h1 class="mb-2 text-2xl font-bold md:mb-1 md:text-3xl">ลงทะเบียนครอบครัว</h1>
		<p class="mb-4 text-sm text-muted-foreground md:mb-6">
			กรอกข้อมูลครอบครัวร่วมด้านบน แล้วเพิ่มสมาชิกทีละคนด้านล่าง — คนที่ 1
			คือผู้ติดต่อหลักของครอบครัวที่ศูนย์จะประสานงานด้วย
		</p>

		{#if !shelterCode}
			<div
				role="alert"
				class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
			>
				ยังไม่ได้เลือกศูนย์พักพิง — เลือกศูนย์จากแถบด้านบนก่อนลงทะเบียน
			</div>
		{:else}
			<p class="mb-4 text-sm">
				บันทึกเข้าศูนย์ <span class="font-semibold">{shelterCode}</span>
			</p>

			{#if saveError}
				<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
			{/if}

			<UnifiedRegistrationForm
				channel="onsite"
				includeVehiclesAssets={true}
				{shelterCode}
				pending={createFamily.isPending || checkingDuplicate}
				onsubmit={handleRegister}
				onDirtyChange={(dirty) => (isDirty = dirty)}
			/>
		{/if}
	{/if}
</div>

<AlertDialog.Root bind:open={overrideDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{OVERRIDE_NEW_REG_TITLE}</AlertDialog.Title>
			<AlertDialog.Description>{overrideDialogBody}</AlertDialog.Description>
		</AlertDialog.Header>
		{#if overrideMatchedMembers.length > 0}
			<div class="text-sm">
				<p class="font-medium">พบข้อมูลที่อาจซ้ำของ:</p>
				<ul class="mt-1 list-disc pl-5">
					{#each overrideMatchedMembers as label (label)}
						<li>{label}</li>
					{/each}
				</ul>
			</div>
		{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{OVERRIDE_NEW_REG_CANCEL}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmOverride}>{OVERRIDE_NEW_REG_CONFIRM}</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
