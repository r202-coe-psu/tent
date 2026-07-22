<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { PublicPortalConfigForm } from '$lib/features/public-portal';
	import ConsoleBanner from '$lib/components/console-banner.svelte';

	let { data }: { data: PageData } = $props();

	const activeType = $derived(page.url.searchParams.get('type') || 'public');

	const categories = [
		{ id: 'public', label: 'หน้าเว็บสาธารณะ (Public)', desc: 'FAQ สำหรับหน้าแรก' },
		{ id: 'registration', label: 'ระบบลงทะเบียน (Registration)', desc: 'FAQ การลงทะเบียน' },
		{ id: 'volunteer', label: 'อาสาสมัคร (Volunteer)', desc: 'FAQ สมัครจิตอาสา' },
		{ id: 'social', label: 'ช่องทางการติดต่อ (Social Media)', desc: 'ตั้งค่าลิงก์ติดต่อ' }
	];

	function navigateToType(type: string) {
		goto(`${resolve('/back-office/public-portal-config')}?type=${encodeURIComponent(type)}`, { replaceState: true });
	}
</script>

<svelte:head>
	<title>{data.title} - Smart Shelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<ConsoleBanner
		title={data.title}
		description="จัดการคำถามที่พบบ่อย (FAQ) และลิงก์ติดต่อสำหรับหน้าเว็บไซต์หลักและระบบต่างๆ"
	/>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr] lg:gap-6">
		<aside class="rounded-xl border bg-card p-4 text-card-foreground shadow-sm h-fit">
			<h2 class="mb-3 text-sm font-semibold text-muted-foreground">หมวดหมู่การตั้งค่า</h2>
			<nav class="flex flex-col gap-2">
				{#each categories as cat (cat.id)}
					{@const isActive = cat.id === activeType}
					<button
						type="button"
						onclick={() => navigateToType(cat.id)}
						aria-current={isActive ? 'page' : undefined}
						class="group flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left transition
							{isActive
							? 'border-transparent bg-primary text-primary-foreground shadow'
							: 'border-input bg-background hover:bg-accent'}"
					>
						<div class="flex-1">
							<div class="text-sm leading-tight font-semibold">{cat.label}</div>
							<div class="mt-1 text-xs {isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}">
								{cat.desc}
							</div>
						</div>
					</button>
				{/each}
			</nav>
		</aside>

			<PublicPortalConfigForm {data} {activeType} />
	</div>
</div>
