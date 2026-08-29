<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Lock from '@lucide/svelte/icons/lock';
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import JobBoard from '$lib/features/volunteers/components/JobBoard.svelte';
	import TicketSearch from '$lib/features/volunteers/components/TicketSearch.svelte';

	let activeTab = $state('jobs'); // 'jobs' | 'ticket'

	function handleSearchTicket(query: string) {
		console.log('Search for ticket:', query);
		// In a real app, this would query the API and redirect to the ticket page
		alert(`ค้นหาตั๋ว: ${query} (Mock)`);
	}
</script>

<svelte:head>
	<title>กระดานรับสมัครอาสาสมัคร — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<PublicHeroMetrics
		title="ตลาดงานอาสาสมัครในศูนย์พักพิง"
		description="ร่วมเป็นส่วนหนึ่งในการช่วยเหลือผู้ประสบภัย เลือกภารกิจที่คุณถนัดและเวลาที่สะดวก พร้อมรับตั๋วดิจิทัล (QR Code Pass) ทันทีโดยไม่ต้องรอ SMS OTP"
		badgeText="Volunteer Job Board"
		badgeIcon={UserPlus}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Top Navigation Tabs (New) -->
	<div class="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div
			class="flex w-full flex-col gap-1 rounded-[20px] border border-border/80 bg-white p-1.5 shadow-sm sm:flex-row sm:items-center sm:gap-0 md:w-auto"
		>
			<button
				class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 py-3 text-sm font-bold shadow-sm transition-transform active:scale-[0.98] sm:w-auto {activeTab ===
				'jobs'
					? 'bg-primary text-white'
					: 'bg-transparent text-primary hover:bg-muted/50'}"
				onclick={() => (activeTab = 'jobs')}
			>
				<Briefcase class="h-4.5 w-4.5" /> ตลาดงานอาสาสมัคร (Job Board)
			</button>
			<button
				class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 py-3 text-sm font-bold transition-colors active:scale-[0.98] sm:w-auto {activeTab ===
				'ticket'
					? 'bg-primary text-white shadow-sm'
					: 'bg-transparent text-primary hover:bg-muted/50'}"
				onclick={() => (activeTab = 'ticket')}
			>
				<Ticket class="h-4.5 w-4.5" /> ค้นหาตั๋วของฉัน (Find My Ticket)
			</button>
		</div>
		<button
			class="hover:bg-opacity-90 flex w-full shrink-0 items-center justify-center gap-2.5 rounded-[20px] bg-primary px-7 py-4 text-sm font-bold text-white shadow-sm transition-all active:scale-[0.98] md:w-auto"
		>
			<Lock class="h-4 w-4 text-warning" /> เข้าสู่ระบบจิตอาสา / ตารางงานของฉัน &rarr;
		</button>
	</div>

	<!-- TAB 1: Job Board -->
	{#if activeTab === 'jobs'}
		<JobBoard />
	{/if}

	<!-- TAB 2: Ticket Search -->
	{#if activeTab === 'ticket'}
		<TicketSearch onSearch={handleSearchTicket} />
	{/if}
</PublicPageShell>
