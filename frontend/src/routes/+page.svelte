<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Compass from '@lucide/svelte/icons/compass';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button';
	import { authStore } from '$lib/stores/auth.svelte';
	import { LOGIN_ROUTE } from '$lib/guards/auth';
	import { isShelterManager, isSystemAdmin } from '$lib/auth/roles';
	import HomePortalCard from '$lib/components/home-portal-card.svelte';

	const roles = $derived(authStore.user?.roles ?? []);
	const canSeeBackoffice = $derived(isSystemAdmin(roles) || isShelterManager(roles));

	async function logout() {
		await authStore.logout();
		toast.success('Logged out successfully');
		await goto(resolve(LOGIN_ROUTE));
	}
</script>

<svelte:head>
	<title>SmartShelter Thailand</title>
</svelte:head>

<div class="flex min-h-svh flex-col bg-background text-foreground">
	<header class="flex items-center justify-end gap-4 border-b px-6 py-3">
		<span class="text-sm text-muted-foreground">{authStore.user?.name}</span>
		<Button variant="outline" size="sm" onclick={logout}>Logout</Button>
	</header>

	<div class="grid flex-1 place-items-center p-6">
		<div class="w-full max-w-7xl px-4">
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
					title="ศูนย์สั่งการ (EOC)"
					description="ภาพรวมสถานการณ์, กระดานเช็คยอด Headcount, แผนที่กระจายทรัพยากร, และระดมอาสาสมัครส่วนกลาง"
					disabled
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
</div>
