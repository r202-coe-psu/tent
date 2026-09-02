<script lang="ts">
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		EvacueeForm,
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
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const createMutation = useCreateEvacuee();

	/** After save: always show Person QR (even arriving). */
	let completedEvacuee = $state<Evacuee | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);

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

	let step = $state<1 | 2 | 3>(1);
	let pageTopRef = $state<HTMLElement | null>(null);

	let prevStep = $state(1);
	$effect(() => {
		if (step !== prevStep) {
			prevStep = step;
			tick().then(() => {
				requestAnimationFrame(() => {
					pageTopRef?.scrollIntoView({ behavior: 'smooth', block: 'start' });
					window.scrollTo({ top: 0, behavior: 'smooth' });
				});
			});
		}
	});

	function backToQueue() {
		completedEvacuee = null;
		goto(resolve('/onsite/people'));
	}
</script>

<svelte:head>
	<title>ลงทะเบียนใหม่ | SmartShelter</title>
</svelte:head>

<div bind:this={pageTopRef} class="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
	{#if completedEvacuee}
		<EvacueeWristbandSuccess evacuee={completedEvacuee} onBack={backToQueue} />
	{:else}
		<button
			onclick={() => goto(resolve('/onsite/people'))}
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
			<EvacueeForm
				onsubmit={(input) => handleRegister(input)}
				pending={createMutation.isPending}
				bind:step
				onsaveerror={(report) => {
					saveError = report;
				}}
				onComplete={(ev) => {
					saveError = null;
					completedEvacuee = ev;
				}}
			/>
		</div>
	{/if}
</div>
