<script lang="ts">
	import { resolve } from '$app/paths';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Building2 from '@lucide/svelte/icons/building-2';
	import Compass from '@lucide/svelte/icons/compass';
	import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';

	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore, persistSelectedShelter } from '$lib/stores/shelter.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { useShelters } from '$lib/features/shelters';
	import {
		isShelterManager,
		isSystemAdmin,
		roleDisplayLabel,
		shelterCodesFromRoles,
		parseCompoundCapability
	} from '$lib/auth/roles';
	import HomePortalCard from '$lib/components/home-portal-card.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const canSeeBackoffice = $derived(isSA || isShelterManager(roles));
	// Query shelters
	const sheltersQuery = useShelters();
	const userShelterCodes = $derived(shelterCodesFromRoles(roles));
	const allowedShelters = $derived(
		sheltersQuery.data?.filter((s) => isSA || userShelterCodes.includes(s.code)) ?? []
	);

	const selectedCode = $derived(shelterStore.selectedShelterCode);
	const currentShelter = $derived(
		allowedShelters.find((s) => s.code === selectedCode) ??
			sheltersQuery.data?.find((s) => s.code === selectedCode)
	);

	// Multi-shelter or System Admin can switch shelters
	const canSwitchShelters = $derived(isSA || allowedShelters.length > 1);

	// Synchronize selected shelter
	$effect(() => {
		if (!allowedShelters.length) return;
		const current = shelterStore.selectedShelterCode;
		if (current && allowedShelters.some((s) => s.code === current)) {
			persistSelectedShelter(current);
			return;
		}
		const preferred =
			allowedShelters.find((s) => userShelterCodes.includes(s.code))?.code ??
			allowedShelters[0].code;
		shelterStore.selectedShelterCode = preferred;
		persistSelectedShelter(preferred);
	});

	function onShelterChange(code: string | undefined) {
		if (!code) return;
		shelterStore.selectedShelterCode = code;
		persistSelectedShelter(code);
	}

	// User details
	const displayName = $derived(
		authStore.user?.display_name || authStore.user?.name || 'ผู้ปฏิบัติงาน'
	);
	const username = $derived(authStore.user?.name ?? '');

	// Role display labels (Thai)
	const userRoleLabels = $derived.by(() => {
		if (isSA) return ['ผู้ดูแลระบบส่วนกลาง'];
		const labels: string[] = [];
		for (const r of roles) {
			if (r.startsWith('shelter:')) continue;
			const parsed = parseCompoundCapability(r);
			if (parsed) {
				const label = roleDisplayLabel(parsed.capability);
				if (!labels.includes(label)) labels.push(label);
			} else {
				const label = roleDisplayLabel(r);
				if (!labels.includes(label)) labels.push(label);
			}
		}
		return labels.length > 0 ? labels : ['ผู้ใช้งานทั่วไป'];
	});

	// onsite + public + volunteer are always shown; system-management is SA-only; back-office
	// is SA/SM — size the grid to the number of visible cards.
	const visibleCards = $derived(3 + (isSA ? 1 : 0) + (canSeeBackoffice ? 1 : 0));
	const gridCols = $derived(
		visibleCards >= 5
			? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
			: visibleCards === 4
				? 'sm:grid-cols-2 lg:grid-cols-4'
				: visibleCards === 3
					? 'sm:grid-cols-2 lg:grid-cols-3'
					: 'sm:grid-cols-2'
	);
</script>

<svelte:head>
	<title>SmartShelter Thailand</title>
</svelte:head>

<div class="flex flex-1 flex-col justify-start p-6 lg:justify-center">
	<div class="mx-auto w-full max-w-7xl px-4">
		<header class="mb-8 text-center">
			<h1 class="mb-2 text-3xl font-bold tracking-wide sm:text-4xl">
				Smart<span class="text-primary">Shelter</span> Thailand
			</h1>
			<p class="text-base font-medium tracking-wide text-muted-foreground sm:text-lg">
				แพลตฟอร์มบริหารจัดการศูนย์พักพิงอัจฉริยะแบบครบวงจร
			</p>
		</header>

		<!-- Welcome & Operational Context Banner -->
		<section
			aria-label="บริบทการปฏิบัติงาน"
			class="mb-8 rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all"
		>
			<div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
				<!-- Left: User Identity & Roles -->
				<div class="flex items-center gap-4">
					<div
						class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
					>
						<User class="size-6" />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-lg font-bold text-foreground">
								สวัสดี, {displayName}
							</span>
							{#if username && username !== displayName}
								<span class="text-xs text-muted-foreground">(@{username})</span>
							{/if}
						</div>
						<div class="mt-1 flex flex-wrap items-center gap-1.5">
							<ShieldCheck class="size-3.5 text-muted-foreground" />
							{#each userRoleLabels as roleLabel (roleLabel)}
								<Badge variant="secondary" class="text-2xs font-normal">
									{roleLabel}
								</Badge>
							{/each}
						</div>
					</div>
				</div>

				<!-- Right: Active Shelter Context & Sync Status -->
				<div
					class="flex flex-col gap-4 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:gap-6 lg:border-t-0 lg:pt-0"
				>
					<!-- Shelter context -->
					<div class="flex flex-col gap-1.5">
						<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
							ศูนย์พักพิงที่ปฏิบัติงาน
						</span>

						{#if canSwitchShelters && allowedShelters.length > 0}
							<div class="w-full sm:w-[280px]">
								<Select.Root
									type="single"
									value={selectedCode ?? ''}
									onValueChange={onShelterChange}
								>
									<Select.Trigger
										class="h-9 w-full border-border bg-background text-sm font-medium"
									>
										<div class="flex items-center gap-2 truncate">
											<Building2 class="size-4 shrink-0 text-primary" />
											<span class="truncate">
												{currentShelter?.name ?? 'เลือกศูนย์พักพิง'}
											</span>
										</div>
									</Select.Trigger>
									<Select.Content class="w-[320px]">
										<Select.Group>
											{#each allowedShelters as shelter (shelter.code)}
												<Select.Item value={shelter.code} label={shelter.name}>
													<div class="flex items-center gap-2">
														<span>{shelter.name}</span>
														<span class="font-mono text-xs text-muted-foreground"
															>({shelter.code})</span
														>
													</div>
												</Select.Item>
											{/each}
										</Select.Group>
									</Select.Content>
								</Select.Root>
							</div>
						{:else if currentShelter}
							<div
								class="inline-flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 text-sm font-medium text-foreground"
							>
								<Building2 class="size-4 text-primary" />
								<span class="truncate">{currentShelter.name}</span>
								<span class="font-mono text-xs text-muted-foreground">({currentShelter.code})</span>
							</div>
						{:else if sheltersQuery.isPending}
							<div class="inline-flex h-9 items-center gap-2 text-xs text-muted-foreground">
								<RefreshCw class="size-3.5 animate-spin text-muted-foreground" />
								<span>กำลังโหลดศูนย์...</span>
							</div>
						{:else}
							<div
								class="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground"
							>
								<Building2 class="size-4 text-muted-foreground" />
								<span>ไม่มีสังกัดศูนย์</span>
							</div>
						{/if}
					</div>

					<!-- Divider on tablet/desktop -->
					<div class="hidden h-10 w-px bg-border/60 sm:block"></div>

					<!-- Sync status indicator -->
					<div class="flex flex-col gap-1.5">
						<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
							สถานะระบบ
						</span>
						<div class="flex h-9 items-center gap-2">
							{#if endpointStore.status === 'connected'}
								<span class="relative flex size-2.5">
									<span
										class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
									></span>
									<span class="relative inline-flex size-2.5 rounded-full bg-emerald-500"></span>
								</span>
								<span class="text-xs font-medium text-foreground">
									เชื่อมต่อแล้ว · ซิงค์ข้อมูลล่าสุด
								</span>
							{:else if endpointStore.status === 'connecting'}
								<span class="relative flex size-2.5">
									<span
										class="relative inline-flex size-2.5 animate-pulse rounded-full bg-amber-500"
									></span>
								</span>
								<span class="text-xs font-medium text-muted-foreground"> กำลังเชื่อมต่อ... </span>
							{:else}
								<span class="relative flex size-2.5">
									<span class="relative inline-flex size-2.5 rounded-full bg-rose-500"></span>
								</span>
								<span class="text-xs font-medium text-destructive"> ออฟไลน์ </span>
							{/if}
						</div>
					</div>
				</div>
			</div>
		</section>

		<main class="grid grid-cols-1 gap-6 md:grid-cols-2 {gridCols}">
			<HomePortalCard
				icon={Users}
				accent="brand"
				title="ระบบส่วนหน้า ณ ศูนย์พักพิง"
				description="ระบบลงทะเบียน (Smart Registration), คัดกรองทางการแพทย์, และจัดสรรโซนที่พัก สำหรับผู้ปฏิบัติงานหน้างาน"
				href={resolve('/onsite')}
			>
				{#snippet actions()}
					{#if currentShelter}
						<div
							class="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
						>
							<Building2 class="size-3.5 text-primary" />
							<span class="max-w-[200px] truncate font-medium text-foreground">
								{currentShelter.name}
							</span>
						</div>
					{/if}
				{/snippet}
			</HomePortalCard>

			<HomePortalCard
				icon={Compass}
				accent="neutral"
				title="เว็บพอร์ทัลสาธารณะ"
				badge="ประชาชน / อาสาสมัคร"
				badgeVariant="neutral"
				description="ค้นหาญาติ, นัดหมายบริจาคสิ่งของ และลงทะเบียนอาสาสมัคร (Public & Volunteer Portal)"
				href={resolve('/')}
			/>

			{#if isSA}
				<HomePortalCard
					icon={Building2}
					accent="accent-purple"
					title="ระบบส่วนกลาง"
					badge="เฉพาะผู้ดูแลระบบ"
					description="จัดการข้อมูลศูนย์พักพิง, ลงทะเบียนบ้านพี่เลี้ยง และตั้งค่าข้อมูลหลักของระบบ"
					href={resolve('/portal/system-management')}
				/>
			{/if}

			<HomePortalCard
				icon={HeartHandshake}
				accent="success"
				title="ระบบบริการจิตอาสา"
				badge="สำหรับอาสาสมัคร"
				badgeVariant="success"
				description="ตารางงานจิตอาสาประจำตัว (My Schedule), อัปเดตความพร้อมปฏิบัติงาน, รายงานตัวปฏิบัติภารกิจ และดูงานด่วน"
				href={resolve('/volunteers/portal')}
			/>

			{#if canSeeBackoffice}
				<HomePortalCard
					icon={Boxes}
					accent="muted"
					title="ระบบส่วนหลัง (Back-End)"
					description="ระบบ ERP บริหารจัดการศูนย์พักพิงแบบครบวงจร, คลังสิ่งของ, ครัวกลาง และ SOP ภาพรวมจังหวัด"
					href={resolve('/back-office')}
				>
					{#snippet actions()}
						{#if currentShelter}
							<div
								class="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
							>
								<Building2 class="size-3.5 text-primary" />
								<span class="max-w-[200px] truncate font-medium text-foreground">
									{currentShelter.name}
								</span>
							</div>
						{/if}
					{/snippet}
				</HomePortalCard>
			{/if}
		</main>
	</div>
</div>
