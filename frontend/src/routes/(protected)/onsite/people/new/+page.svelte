<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
		peopleRepository,
		deriveDuplicateCheckQuery,
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
		type SaveFailureReport,
		type UnifiedRegistrationInput
	} from '$lib/features/people';
	import { unassignedRegistrationRemote } from '$lib/features/unassigned-registration';
	import { getShelterCode } from '$lib/db/shelter';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const createFamily = useCreateFamilyRegistration();

	let completed = $state<{ household: Household; members: Evacuee[] } | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);
	let checkingDuplicate = $state(false);
	let overrideDialogOpen = $state(false);
	let overrideDialogBody = $state(OVERRIDE_NEW_REG_BODY);
	let overrideConfirmedForQuery = '';
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
		const primary = input.members[0];
		const dupQuery = primary ? deriveDuplicateCheckQuery(primary) : null;
		if (!dupQuery) return true;
		if (overrideConfirmedForQuery === dupQuery) return true;

		checkingDuplicate = true;
		let localCount: number;
		try {
			localCount = (await peopleRepository().searchEvacuees(dupQuery)).length;
		} catch {
			checkingDuplicate = false;
			toast.error('ตรวจสอบข้อมูลซ้ำไม่ได้ ลองบันทึกใหม่อีกครั้ง');
			return false;
		}

		let poolCount = 0;
		let poolError = false;
		try {
			poolCount = (await unassignedRegistrationRemote.searchOpen(dupQuery)).results.length;
		} catch {
			poolError = true;
		}
		checkingDuplicate = false;

		const locked = isIntakeNewRegistrationLocked({
			hasSearched: true,
			poolError,
			hasFederatedHits: hasFederatedIntakeHits(localCount, poolCount),
			overrideConfirmed: false
		});
		if (!locked) return true;

		overrideDialogBody = poolError ? OVERRIDE_NEW_REG_POOL_ERROR_BODY : OVERRIDE_NEW_REG_BODY;
		overrideDialogOpen = true;
		return new Promise<boolean>((resolve) => {
			overrideResolver = (confirmed) => {
				if (confirmed) overrideConfirmedForQuery = dupQuery;
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

		const shelterCode = getShelterCode();
		const ctx = {
			shelterCode,
			createdBy: authStore.user?.name ?? 'unknown'
		};

		saveError = null;

		try {
			const result = await createFamily.mutateAsync({
				input,
				ctx,
				channel: 'onsite'
			});
			saveError = null;
			isDirty = false;
			isNavigatingAfterSave = true;
			completed = result;
			toast.success(`ลงทะเบียนครอบครัว ${result.members.length} คน สำเร็จ`);
		} catch (err) {
			saveError = buildSaveFailureReport(err, {
				summaryTh: t.saveErrorSummary,
				shelterCode,
				rollbackNote:
					'compensated: deleted household + members created in this submit when possible'
			});
			toast.error(t.toastSaveFailed);
			throw err;
		}
	}

	function backToQueue() {
		isNavigatingAfterSave = true;
		completed = null;
		goto(resolve('/onsite/people'));
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
			กรอกข้อมูลครอบครัวร่วมด้านบน แล้วเพิ่มสมาชิกทีละคนด้านล่าง — คนแรกคือผู้ติดต่อหลัก
		</p>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		<UnifiedRegistrationForm
			channel="onsite"
			includeVehiclesAssets={true}
			shelterCode={getShelterCode()}
			pending={createFamily.isPending || checkingDuplicate}
			onsubmit={handleRegister}
			onDirtyChange={(dirty) => (isDirty = dirty)}
		/>
	{/if}
</div>

<AlertDialog.Root bind:open={overrideDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{OVERRIDE_NEW_REG_TITLE}</AlertDialog.Title>
			<AlertDialog.Description>{overrideDialogBody}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>{OVERRIDE_NEW_REG_CANCEL}</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmOverride}>{OVERRIDE_NEW_REG_CONFIRM}</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
