<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		FamilyBatchPrint,
		RegistrationSaveErrorAlert,
		UnifiedRegistrationForm,
		useCreateFamilyRegistration,
		buildSaveFailureReport,
		EVACUEE_PAGE_I18N,
		type Evacuee,
		type Household,
		type SaveFailureReport,
		type UnifiedRegistrationInput
	} from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const createFamily = useCreateFamilyRegistration();

	let completed = $state<{ household: Household; members: Evacuee[] } | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completed) return;
		if (isDirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
			nav.cancel();
		}
	});

	async function handleRegister(input: UnifiedRegistrationInput) {
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

<div class="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
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
			pending={createFamily.isPending}
			onsubmit={handleRegister}
			onDirtyChange={(dirty) => (isDirty = dirty)}
		/>
	{/if}
</div>
