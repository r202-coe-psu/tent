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
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import { env } from '$env/dynamic/public';

	const donationStore = setDonationStore();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';

	const steps = [
		{ id: 'needs', icon: AlertTriangle, label: 'ความต้องการ' },
		{ id: 'form', icon: Package, label: 'รายการบริจาค' },
		{ id: 'time', icon: MapPin, label: 'นัดหมาย' },
		{ id: 'ticket', icon: QrCode, label: 'ตั๋วบริจาค' }
	] as const;

	const stepIndexMap = {
		needs: 0,
		form: 1,
		time: 2,
		ticket: 3
	} as const;

	const activeIndex = $derived(stepIndexMap[donationStore.activeTab] ?? 0);

	const progressWidth = $derived(`${(activeIndex / (steps.length - 1)) * 100}%`);
</script>

<svelte:head>
	<title>บริจาคและจองคิว — Smart Shelter</title>
	{#if siteKey}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

<PublicPageShell class="space-y-6">
	<!-- Hero Banner (Only when activeTab is 'needs') -->
	{#if donationStore.activeTab === 'needs'}
		<div class="animate-in duration-300 fade-in">
			<PublicHeroMetrics
				title="กระดานความต้องการด่วน"
				description="อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง คุณสามารถช่วยเติมเต็มในส่วนที่ขาดแคลนได้ทันที"
				badgeText="Donation Board"
				badgeIcon={HeartHandshake}
				showLivePing={false}
				bgClass="bg-primary-dark"
				showSearch={false}
			/>
		</div>
	{/if}

	<!-- Full-width Step Navigation / Flow Progress -->
	<div
		class="w-full overflow-hidden rounded-2xl border border-black/[0.04] bg-white p-4 shadow-sm sm:px-8"
	>
		<div class="relative mx-auto flex w-full items-center justify-between">
			<!-- Progress Bar Line Container — the track both bars are measured against, so
			     the active bar can never run past the last step or out of the card. -->
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
				{@const isActive = donationStore.activeTab === step.id}
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
							class="hidden text-[10px] font-bold tracking-widest uppercase sm:block
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

	<!-- Render Components based on state -->
	<div class="w-full transition-all duration-500">
		{#if donationStore.activeTab === 'needs'}
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
