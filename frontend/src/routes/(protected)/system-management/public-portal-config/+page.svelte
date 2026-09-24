<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { PublicPortalConfigForm } from '$lib/features/public-portal';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import StaffHub from '$lib/components/staff-hub.svelte';
	import StaffSideNav, { type StaffSideNavItem } from '$lib/components/staff-side-nav.svelte';
	import ExternalLink from '@lucide/svelte/icons/external-link';

	let { data }: { data: PageData } = $props();

	const activeType = $derived(page.url.searchParams.get('type') || 'public');

	function navigateToType(type: string) {
		goto(`${resolve('/system-management/public-portal-config')}?type=${encodeURIComponent(type)}`, {
			replaceState: true
		});
	}

	function getPreviewUrl(type: string) {
		if (type === 'public' || type === 'social') return '/';
		if (type === 'registration') return '/register';
		if (type === 'volunteer') return '/volunteers';
		return '/';
	}

	const items = $derived<StaffSideNavItem[]>([
		{
			id: 'public',
			label: 'หน้าเว็บสาธารณะ',
			description: 'FAQ สำหรับหน้าแรก',
			onclick: () => navigateToType('public')
		},
		{
			id: 'registration',
			label: 'ระบบลงทะเบียน',
			description: 'FAQ การลงทะเบียน',
			onclick: () => navigateToType('registration')
		},
		{
			id: 'volunteer',
			label: 'อาสาสมัคร',
			description: 'FAQ สมัครอาสาสมัคร',
			onclick: () => navigateToType('volunteer')
		},
		{
			id: 'social',
			label: 'ช่องทางการติดต่อ',
			description: 'ตั้งค่าลิงก์ติดต่อ',
			onclick: () => navigateToType('social')
		}
	]);
</script>

<svelte:head>
	<title>{data.title} - Smart Shelter</title>
</svelte:head>

<StaffPageShell
	title={data.title}
	description="จัดการคำถามที่พบบ่อย (FAQ) และลิงก์ติดต่อสำหรับหน้าเว็บไซต์หลักและระบบต่างๆ"
	maxWidth="7xl"
>
	<StaffHub>
		{#snippet nav()}
			<StaffSideNav
				{items}
				activeId={activeType}
				sectionLabel="หมวดหมู่"
				ariaLabel="หมวดหมู่การตั้งค่า"
			/>
		{/snippet}

		<div class="min-w-0 p-4 sm:p-6">
			<div class="mb-4 flex justify-end">
				<a
					href={getPreviewUrl(activeType)}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-[#0A2647] transition-colors hover:bg-sky-100"
				>
					<ExternalLink class="size-3" />
					ดูการแสดงผลหน้าบ้าน
				</a>
			</div>
			<PublicPortalConfigForm {data} {activeType} />
		</div>
	</StaffHub>
</StaffPageShell>
