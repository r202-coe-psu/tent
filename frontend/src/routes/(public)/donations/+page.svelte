<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Package from '@lucide/svelte/icons/package';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import { setDonationStore } from './donation.svelte';
	import NeedsBoard from '$lib/components/public-donor-needs.svelte';
	import DonorForm from '$lib/components/form/form-donor.svelte';
	import TimeSelection from '$lib/components/form/donor-time-selection-form.svelte';
	import SuccessTicket from '$lib/components/public-donor-success-ticket.svelte';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { env } from '$env/dynamic/public';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_DONATIONS_I18N } from '$lib/constants/i18n';

	const donationStore = setDonationStore();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const t = $derived(getTranslation(PUBLIC_DONATIONS_I18N, langState.current));

	const steps = $derived([
		{ id: 'needs', icon: AlertTriangle, label: t.step1 },
		{ id: 'form', icon: Package, label: t.step2 },
		{ id: 'time', icon: MapPin, label: t.step3 },
		{ id: 'ticket', icon: QrCode, label: t.step4 }
	] as const);

	const stepIndexMap: Record<string, number> = {
		needs: 0,
		'shelter-details': 0,
		form: 1,
		time: 2,
		ticket: 3
	};

	const activeIndex = $derived(stepIndexMap[donationStore.activeTab] ?? 0);

	const progressWidth = $derived(`${(activeIndex / (steps.length - 1)) * 100}%`);

	function isStepActive(stepId: string): boolean {
		const current = donationStore.activeTab as string;
		if (current === stepId) return true;
		if (stepId === 'needs' && current === 'shelter-details') return true;
		return false;
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
	{#if siteKey}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

<PublicPageShell maxWidth="max-w-5xl" class="space-y-6">
	<!-- Hero Banner (Only when activeTab is 'needs') -->
	{#if donationStore.activeTab === 'needs'}
		<div class="w-full animate-in duration-300 fade-in">
			<div
				class="relative flex flex-col items-start justify-start gap-6 overflow-hidden rounded-3xl bg-[#013481] p-6 text-left text-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:p-10"
			>
				<div
					class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] bg-[size:4rem_4rem] opacity-10"
				></div>

				<div class="relative z-10 max-w-2xl space-y-3">
					<div
						class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold tracking-wider text-blue-100 uppercase"
					>
						<HeartHandshake class="h-3.5 w-3.5 text-blue-200" />
						{t.donationBoard}
					</div>
					<h1 class="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
						{t.heroTitlePrefix} <span class="text-blue-200">{t.heroTitleHighlight}</span>
					</h1>
					<p class="text-sm leading-relaxed font-medium text-blue-100/80 sm:text-base">
						{t.heroDesc}
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Full-width Step Navigation / Flow Progress -->
	<!-- CR-052 §2.1: step indicator starts at step 2 — hidden on the needs board -->
	{#if donationStore.activeTab !== 'needs' && donationStore.activeTab !== 'shelter-details'}
		<div
			class="w-full overflow-hidden rounded-2xl border border-black/[0.04] bg-white p-4 shadow-sm sm:px-8"
		>
			<div class="relative mx-auto flex w-full items-center justify-between">
				<!-- Progress Bar Line Container -->
				<div
					class="absolute top-5 right-6 left-6 h-1 -translate-y-1/2 sm:top-1/2 sm:right-10 sm:left-10"
				>
					<!-- Progress Bar Background -->
					<div class="absolute inset-0 rounded-full bg-slate-100"></div>
					<!-- Active Progress Bar -->
					<div
						class="absolute top-0 bottom-0 left-0 rounded-full bg-[#013365] transition-all duration-500"
						style:width={progressWidth}
					></div>
				</div>

				{#each steps as step, idx (step.id)}
					{@const isActive = isStepActive(step.id)}
					{@const isCompleted = activeIndex > idx}
					<button
						type="button"
						onclick={() => {
							donationStore.activeTab = step.id;
						}}
						disabled={donationStore.reachedStep < idx + 1}
						class="relative z-10 flex flex-col items-center gap-2 rounded-xl p-1 transition-all sm:flex-row sm:bg-white sm:px-4 sm:py-2.5
							{isActive
							? 'ring-[#013365]/20 sm:-translate-y-0.5 sm:shadow-md sm:ring-1 sm:ring-black/5'
							: 'cursor-pointer hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30'}"
					>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10
							{isActive
								? 'bg-[#013365] text-white shadow-md'
								: isCompleted
									? 'bg-[#013365] text-white'
									: 'border-2 border-white bg-slate-100 text-slate-400'}"
						>
							<step.icon class={isActive || isCompleted ? 'h-[18px] w-[18px]' : 'h-4 w-4'} />
						</div>
						<div class="mt-1 flex flex-col items-center sm:mt-0 sm:items-start">
							<span
								class="hidden text-2xs font-bold tracking-widest uppercase sm:block
								{isActive || isCompleted ? 'text-[#013365]' : 'text-slate-400'}"
							>
								STEP 0{idx + 1}
							</span>
							<span
								class="text-xs font-semibold whitespace-nowrap sm:text-sm
								{isActive ? 'font-bold text-slate-900' : isCompleted ? 'text-slate-700' : 'text-slate-500'}"
							>
								{step.label}
							</span>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Render Components based on state -->
	<div class="w-full transition-all duration-500">
		{#if donationStore.activeTab === 'needs' || donationStore.activeTab === 'shelter-details'}
			<NeedsBoard />
		{:else if donationStore.activeTab === 'form'}
			<DonorForm />
		{:else if donationStore.activeTab === 'time'}
			<TimeSelection />
		{:else if donationStore.activeTab === 'ticket'}
			<SuccessTicket />
		{/if}
	</div>
</PublicPageShell>
