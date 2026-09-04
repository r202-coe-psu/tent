<script lang="ts">
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Ticket from '@lucide/svelte/icons/ticket';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import { VolunteerAccessPortal } from '$lib/features/volunteer-portal';
	import JobBoard from '$lib/features/volunteers/components/JobBoard.svelte';
	import TicketSearch from '$lib/features/volunteers/components/TicketSearch.svelte';

	let activeTab = $state<'jobs' | 'portal' | 'ticket'>(
		(page.url.searchParams.get('tab') as 'jobs' | 'portal' | 'ticket') ?? 'jobs'
	);

	function handleSearchTicket(query: string) {
		const token = query.trim();
		if (token) {
			goto(`/volunteer/ticket/${encodeURIComponent(token)}`);
		}
	}
</script>

<svelte:head>
	<title>ระบบงานข้อมูลอาสาสมัคร — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<PublicHeroMetrics
		title="ระบบงานข้อมูลอาสาสมัครร่วมบูรณาการภัยพิบัติ"
		description="เชื่อมประสานความดี ขจัดปัญหาร่วมกระจุกตัว ด้วยการคัดกรองทักษะ (Skill Matching) ออกรหัสลงทะเบียน (Role Card) ปฏิบัติอาสา และติดตามสวัสดิการตามมาตรฐาน Sphere"
		badgeText="Rescue Volunteer Platform"
		badgeIcon={UserPlus}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Tab Bar Navigation -->
	<div class="flex justify-start border-b border-border">
		<div class="inline-flex rounded-t-xl border-x border-t border-border/50 bg-muted/30 p-1">
			<button
				onclick={() => (activeTab = 'jobs')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'jobs'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<Briefcase class="h-3.5 w-3.5" />
				ตลาดงานอาสาสมัคร (Job Board)
			</button>
			<button
				onclick={() => (activeTab = 'portal')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'portal'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<QrCode class="h-3.5 w-3.5" />
				พอร์ทัล & บัตรงานอาสา (Portal)
			</button>
			<button
				onclick={() => (activeTab = 'ticket')}
				class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all {activeTab ===
				'ticket'
					? 'bg-card text-foreground shadow-sm'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				<Ticket class="h-3.5 w-3.5" />
				ค้นหาตั๋วของฉัน (Find Ticket)
			</button>
		</div>
	</div>

	<!-- TAB 1: ตลาดงานอาสาสมัคร (Live Job Board) -->
	{#if activeTab === 'jobs'}
		<JobBoard />
	{/if}

	<!-- TAB 2: พอร์ทัล & บัตรงานอาสา (Volunteer Access Portal) -->
	{#if activeTab === 'portal'}
		<VolunteerAccessPortal />
	{/if}

	<!-- TAB 3: ค้นหาตั๋วของฉัน (Ticket Search) -->
	{#if activeTab === 'ticket'}
		<TicketSearch onSearch={handleSearchTicket} />
	{/if}
</PublicPageShell>
