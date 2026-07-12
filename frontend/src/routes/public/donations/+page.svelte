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
	const progressWidth = $derived(`${activeIndex * 33.33}%`);
</script>

<svelte:head>
	<title>บริจาคและจองคิว — Smart Shelter</title>
	{#if siteKey}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8 space-y-6">
	<!-- Hero Banner (Only when activeTab is 'needs') -->
	{#if donationStore.activeTab === 'needs'}
		<div class="w-full animate-in fade-in duration-300">
			<div class="relative flex flex-col justify-start items-start gap-6 overflow-hidden rounded-3xl bg-[#013481] p-6 text-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:p-10 text-left">
				<div class="absolute inset-0 bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-10 pointer-events-none [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]"></div>

				<div class="relative z-10 space-y-3 max-w-2xl">
					<div class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-bold tracking-wider text-blue-100 uppercase">
						<HeartHandshake class="h-3.5 w-3.5 text-blue-200" /> DONATION BOARD
					</div>
					<h1 class="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
						กระดาน<span class="text-blue-200">ความต้องการด่วน</span>
					</h1>
					<p class="text-sm font-medium text-blue-100/80 leading-relaxed sm:text-base">
						อัปเดตข้อมูลแบบเรียลไทม์จากทุกศูนย์พักพิง
						คุณสามารถช่วยเติมเต็มในส่วนที่ขาดแคลนได้ทันที
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Full-width Step Navigation / Flow Progress -->
	<div class="w-full rounded-2xl border border-black/[0.04] bg-white p-4 shadow-sm sm:px-8">
		<div class="relative mx-auto flex w-full justify-between items-center">
			<!-- Progress Bar Background -->
			<div class="absolute left-[10%] right-[10%] top-5 h-1 bg-slate-100 rounded-full sm:top-1/2 sm:-translate-y-1/2"></div>
			<!-- Active Progress Bar -->
			<div
				class="absolute left-[10%] top-5 h-1 bg-[#013365] rounded-full transition-all duration-500 sm:top-1/2 sm:-translate-y-1/2"
				style:width={progressWidth}
			></div>

			{#each steps as step, idx (step.id)}
				{@const isActive = donationStore.activeTab === step.id}
				{@const isCompleted = activeIndex > idx}
				{@const isClickable = donationStore.reachedStep >= (idx + 1) && step.id !== 'ticket'}
				<button
					type="button"
					onclick={() => {
						if (isClickable || (step.id === 'ticket' && donationStore.reachedStep >= 4)) {
							donationStore.activeTab = step.id;
						}
					}}
					disabled={!(isClickable || (step.id === 'ticket' && donationStore.reachedStep >= 4))}
					class="relative z-10 flex flex-col items-center gap-2 rounded-xl p-1 transition-all sm:flex-row sm:bg-white sm:px-4 sm:py-2.5 
						{isActive ? 'sm:shadow-md sm:ring-1 sm:ring-black/5 ring-[#013365]/20 sm:-translate-y-0.5' : 'hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'}"
				>
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10 
						{isActive ? 'bg-[#013365] text-white shadow-md' : isCompleted ? 'bg-[#013365] text-white' : 'bg-slate-100 text-slate-400 border-2 border-white'}"
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
							class="text-xs sm:text-sm font-semibold whitespace-nowrap 
							{isActive ? 'text-slate-900 font-bold' : isCompleted ? 'text-slate-700' : 'text-slate-500'}"
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
</div>
