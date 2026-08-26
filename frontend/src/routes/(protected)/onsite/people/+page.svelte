<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		EvacueeForm,
		EvacueeWristbandSuccess,
		RegistrationSaveErrorAlert,
		useCreateEvacueeWithScreening,
		buildSaveFailureReport,
		EVACUEE_PAGE_I18N,
		type EvacueeInput,
		type Evacuee,
		type SaveFailureReport
	} from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import Zap from '@lucide/svelte/icons/zap';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getTranslation } from '$lib/utils/i18n';
	import { languageStore } from '$lib/stores/language.svelte';

	const t = $derived(getTranslation(EVACUEE_PAGE_I18N, languageStore.current));
	const createMutation = useCreateEvacueeWithScreening();

	let isFastTrack = $derived(page.url.searchParams.get('mode') === 'fast_track');

	// Completed evacuee after zone selection — drives the success screen
	let completedEvacuee = $state<Evacuee | null>(null);
	let saveError = $state<SaveFailureReport | null>(null);

	async function handleRegister(input: EvacueeInput, symptoms: string[]) {
		const shelterCode = getShelterCode();
		const ctx = {
			shelterCode,
			createdBy: authStore.user?.name ?? 'unknown'
		};
		const track = isFastTrack ? 'fast_track' : symptoms.length > 0 ? 'fast_track' : 'normal';

		saveError = null;

		try {
			const { evacuee } = await createMutation.mutateAsync({
				input: { ...input, track },
				screening: {
					symptoms,
					temperature_c: null,
					track,
					needs_referral: false
				},
				ctx
			});
			return evacuee;
		} catch (err) {
			saveError = buildSaveFailureReport(err, {
				summaryTh: t.saveErrorSummary,
				shelterCode,
				rollbackNote:
					'compensated: deleted medical + evacuee created in this submit (screening is append-only and is not deleted if it was written)'
			});
			toast.error(t.toastSaveFailed);
			throw err;
		}
	}

	let step = $state<1 | 2 | 3 | 4 | 5 | 6>(1);
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
	{#if completedEvacuee}
		<EvacueeWristbandSuccess
			evacuee={completedEvacuee}
			onBack={() => {
				completedEvacuee = null;
			}}
		/>
	{:else}
		<button
			onclick={() => goto(resolve('/onsite'))}
			class="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<span>{t.back}</span>
		</button>

		<h1 class="mb-4 text-2xl font-bold md:mb-6 md:text-3xl">{t.title}</h1>

		{#if saveError}
			<RegistrationSaveErrorAlert report={saveError} ondismiss={() => (saveError = null)} />
		{/if}

		{#if isFastTrack}
			<div
				class="mb-4 flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50/50 p-3 md:mb-6 md:items-center md:gap-4 md:p-4"
			>
				<div
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-yellow-500 md:h-10 md:w-10"
				>
					<Zap class="size-5 fill-yellow-500" />
				</div>
				<div>
					<h2 class="text-sm font-bold text-purple-900">{t.fastTrackTitle}</h2>
					<p class="text-xs font-semibold text-purple-700">
						{t.fastTrackDesc}
					</p>
				</div>
			</div>
		{/if}

		<EvacueeForm
			onsubmit={handleRegister}
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
	{/if}
</div>
