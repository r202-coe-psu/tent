<script lang="ts">
	import type { PageData } from './$types';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	import ShelterHero from './components/shelter-hero.svelte';
	import ShelterAdmission from './components/shelter-admission.svelte';
	import ShelterTravel from './components/shelter-travel.svelte';
	import ShelterZones from './components/shelter-zones.svelte';
	import ShelterFacilities from './components/shelter-facilities.svelte';
	import ShelterContact from './components/shelter-contact.svelte';
	import { PublicPageShell } from '$lib/features/public-portal';

	let { data }: { data: PageData } = $props();
	let shelter = $derived(data.shelter);
</script>

<svelte:head>
	<title>{shelter?.name || 'ข้อมูลศูนย์พักพิง'} - Smart Shelter</title>
</svelte:head>

<div class="pb-20">
	<!-- Top Navigation Bar -->
	<div class="border-b border-border bg-card">
		<div class="mx-auto flex max-w-380 items-center justify-between px-4 py-3 sm:px-6">
			<a
				href="/public/shelters"
				class="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-bold text-foreground/90 transition-colors hover:text-primary"
			>
				<ChevronLeft class="h-4 w-4" />
				ย้อนกลับหน้าตรวจสอบสถานะ
			</a>
			<div
				class="hidden text-[10px] font-bold tracking-widest text-muted-foreground/80 uppercase md:block"
			>
				SMARTSHELTER • ข้อมูลศูนย์พักพิงฉบับสมบูรณ์
			</div>
		</div>
	</div>

	{#if shelter}
		<PublicPageShell class="space-y-8">
			<ShelterHero {shelter} />

			<!-- Main Content Grid -->
			<div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
				<!-- LEFT COLUMN -->
				<div class="flex flex-col gap-8">
					<ShelterAdmission {shelter} />
					<ShelterTravel {shelter} />
					<ShelterZones {shelter} />
				</div>

				<!-- RIGHT COLUMN -->
				<div class="flex flex-col gap-8">
					<ShelterFacilities {shelter} />
					<ShelterContact {shelter} />
				</div>
			</div>
		</PublicPageShell>
	{:else}
		<div class="flex min-h-[50vh] flex-col items-center justify-center px-4 py-20 text-center">
			<AlertTriangle class="mb-4 h-12 w-12 text-muted-foreground/60" />
			<h2 class="text-xl font-bold text-foreground/90">ไม่พบข้อมูลศูนย์พักพิง</h2>
			<p class="mt-2 text-sm text-muted-foreground">
				ขออภัย ข้อมูลที่คุณต้องการค้นหาอาจถูกลบหรือไม่มีอยู่ในระบบ
			</p>
			<a
				href="/public/shelters"
				class="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
			>
				กลับไปหน้าตรวจสอบสถานะ
			</a>
		</div>
	{/if}
</div>
