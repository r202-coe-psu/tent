<script lang="ts">
	import { resolve } from '$app/paths';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Compass from '@lucide/svelte/icons/compass';
	import Users from '@lucide/svelte/icons/users';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isShelterManager, isSystemAdmin } from '$lib/auth/roles';
	import HomePortalCard from '$lib/components/home-portal-card.svelte';

	const roles = $derived(authStore.user?.roles ?? []);
	const canSeeBackoffice = $derived(isSystemAdmin(roles) || isShelterManager(roles));
</script>

<svelte:head>
	<title>SmartShelter Thailand</title>
</svelte:head>

<div class="flex flex-1 flex-col justify-start p-6 lg:justify-center">
	<div class="mx-auto w-full max-w-7xl px-4">
		<header class="mb-12 text-center">
			<h1 class="mb-3 text-4xl font-bold tracking-wide">
				Smart<span class="text-primary">Shelter</span> Thailand
			</h1>
			<p class="text-lg font-medium tracking-wide text-muted-foreground">
				แพลตฟอร์มบริหารจัดการศูนย์พักพิงอัจฉริยะแบบครบวงจร
			</p>
		</header>

		<main
			class="grid grid-cols-1 gap-6 md:grid-cols-2 {canSeeBackoffice
				? 'lg:grid-cols-4'
				: 'lg:grid-cols-3'}"
		>
			<HomePortalCard
				icon={Users}
				accent="brand"
				title="ระบบส่วนหน้า ณ ศูนย์พักพิง"
				description="ระบบลงทะเบียน (Smart Registration), คัดกรองทางการแพทย์, และจัดสรรโซนที่พักสำหรับผู้ปฏิบัติงานหน้างาน"
				href={resolve('/onsite')}
			/>

			<HomePortalCard
				icon={Compass}
				accent="neutral"
				title="เว็บพอร์ทัลสาธารณะ"
				badge="ประชาชน / อาสาสมัคร"
				description="ค้นหาญาติ, นัดหมายบริจาคสิ่งของ และลงทะเบียนอาสาสมัคร (Public & Volunteer Portal)"
				href={resolve('/public')}
			/>

			<HomePortalCard
				icon={Building2}
				accent="accent-purple"
				title="ทะเบียนพื้นที่และศูนย์พักพิง"
				description="จัดการข้อมูลศูนย์พักพิง, ลงทะเบียนบ้านพี่เลี้ยง และตั้งค่าข้อมูลหลักของระบบ"
				href={resolve('/portal/system-management')}
			/>

			{#if canSeeBackoffice}
				<HomePortalCard
					icon={Boxes}
					accent="muted"
					title="ระบบส่วนหลัง (Back-Office)"
					description="ระบบ ERP บริหารจัดการศูนย์พักพิงแบบครบวงจร, คลังสิ่งของ, ครัวกลาง และ SOP ภาพรวมจังหวัด"
					href={resolve('/back-office')}
				/>
			{/if}
		</main>
	</div>
</div>
