<script lang="ts">
	import Compass from '@lucide/svelte/icons/compass';
	import Heart from '@lucide/svelte/icons/heart';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import FileText from '@lucide/svelte/icons/file-text';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

	import { donationStore } from './donation.svelte';
	import NeedsBoard from './components/NeedsBoard.svelte';
	import DonorForm from './components/DonorForm.svelte';
	import TimeSelection from './components/TimeSelection.svelte';
	import OtpVerification from './components/OtpVerification.svelte';
	import SuccessTicket from './components/SuccessTicket.svelte';

</script>

<svelte:head>
	<title>บริจาคและจองคิว — Smart Shelter</title>
	<script src="https://www.google.com/recaptcha/api.js" async defer></script>
	<script>
		// Global callback for reCAPTCHA
		function onCaptchaSuccess(token) {
			window.__captchaToken = token;
		}
	</script>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	<!-- Tab Bar Navigation -->
	<div class="mb-8 flex justify-center">

		<div class="inline-flex rounded-xl bg-muted/60 p-1 border border-border/50 shadow-2xs">
			<button 
				onclick={() => { if (donationStore.reachedStep >= 1) donationStore.activeTab = 'needs'; }}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {donationStore.activeTab === 'needs' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"

			>
				<Compass class="h-3.5 w-3.5" />
				ความต้องการด่วน
			</button>

			<button 
				onclick={() => { if (donationStore.reachedStep >= 2) donationStore.activeTab = 'form'; }}
				disabled={donationStore.reachedStep < 2}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {donationStore.activeTab === 'form' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'} {donationStore.reachedStep < 2 ? 'opacity-40 cursor-not-allowed' : ''}"

			>
				<Heart class="h-3.5 w-3.5" />
				ฟอร์มบริจาค
			</button>
			<button 
				onclick={() => { if (donationStore.reachedStep >= 3) donationStore.activeTab = 'time'; }}
				disabled={donationStore.reachedStep < 3}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {donationStore.activeTab === 'time' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'} {donationStore.reachedStep < 3 ? 'opacity-40 cursor-not-allowed' : ''}"
			>
				<MapPin class="h-3.5 w-3.5" />
				เวลา/สถานที่
			</button>
			<!-- Show OTP tab only if reached OTP stage -->
			{#if donationStore.reachedStep >= 4 && donationStore.activeTab === 'otp'}
				<button 
					class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all bg-card text-foreground shadow-xs"
				>
					<ShieldAlert class="h-3.5 w-3.5" />
					ยืนยันตัวตน
				</button>
			{/if}
			<button 
				onclick={() => { if (donationStore.reachedStep >= 5) donationStore.activeTab = 'ticket'; }}
				disabled={donationStore.reachedStep < 5}
				class="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all {donationStore.activeTab === 'ticket' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'} {donationStore.reachedStep < 5 ? 'opacity-40 cursor-not-allowed' : ''}"
			>
				<FileText class="h-3.5 w-3.5" />
				ตั๋วของฉัน
			</button>
		</div>
	</div>

	<!-- Render Components based on state -->
	{#if donationStore.activeTab === 'needs'}
		<NeedsBoard />
	{:else if donationStore.activeTab === 'form'}
		<DonorForm />
	{:else if donationStore.activeTab === 'time'}
		<TimeSelection />
	{:else if donationStore.activeTab === 'otp'}
		<OtpVerification />
	{:else if donationStore.activeTab === 'ticket'}
		<SuccessTicket />
	{/if}
</div>
