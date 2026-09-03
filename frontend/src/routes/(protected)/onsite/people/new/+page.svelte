<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		RegistrationShell,
		EvacueeWristbandSuccess,
		RegistrationSaveErrorAlert,
		useCreateEvacuee,
		buildSaveFailureReport,
		EVACUEE_PAGE_I18N,
		type EvacueeInput,
		type Evacuee,
		type SaveFailureReport
	} from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const createMutation = useCreateEvacuee();

	/** After save: always show Person QR (even arriving). */
	let completedEvacuee = $state<Evacuee | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);
	let isDirty = $state(false);
	let isNavigatingAfterSave = $state(false);

	beforeNavigate((nav) => {
		if (isNavigatingAfterSave || completedEvacuee) return;
		if (isDirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) {
			nav.cancel();
		}
	});

	async function handleRegister(input: EvacueeInput) {
		const shelterCode = getShelterCode();
		const ctx = {
			shelterCode,
			createdBy: authStore.user?.name ?? 'unknown'
		};

		saveError = null;

		try {
			return await createMutation.mutateAsync({
				input: { ...input, status: 'arriving', track: 'normal' },
				ctx
			});
		} catch (err) {
			saveError = buildSaveFailureReport(err, {
				summaryTh: t.saveErrorSummary,
				shelterCode,
				rollbackNote: 'compensated: deleted medical + evacuee created in this submit when possible'
			});
			toast.error(t.toastSaveFailed);
			throw err;
		}
	}

	function backToQueue() {
		isNavigatingAfterSave = true;
		completedEvacuee = null;
		goto(resolve('/onsite/people'));
	}
</script>

<svelte:head>
	<title>ลงทะเบียนใหม่ | SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
	{#if completedEvacuee}
		<EvacueeWristbandSuccess evacuee={completedEvacuee} onBack={backToQueue} />
	{:else}
		<button
			type="button"
			onclick={backToQueue}
			class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<span>กลับคิวทะเบียน</span>
		</button>

		<h1 class="mb-4 text-2xl font-bold md:mb-6 md:text-3xl">ลงทะเบียนผู้ประสบภัยใหม่</h1>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		<div class="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-8 md:p-10">
			<RegistrationShell
				mode="walk-in"
				onsubmit={(input) => handleRegister(input)}
				pending={createMutation.isPending}
				onDirtyChange={(dirty) => (isDirty = dirty)}
				onsaveerror={(report) => {
					saveError = report;
				}}
				onComplete={(ev) => {
					saveError = null;
					isDirty = false;
					isNavigatingAfterSave = true;
					completedEvacuee = ev;
				}}
			/>
		</div>
	{/if}
</div>
