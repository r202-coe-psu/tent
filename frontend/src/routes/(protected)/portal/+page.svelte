<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import User from '@lucide/svelte/icons/user';

	import { dev } from '$app/environment';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore, persistSelectedShelter } from '$lib/stores/shelter.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { useShelters } from '$lib/features/shelters';
	import {
		isSystemAdmin,
		roleDisplayLabel,
		shelterCodesFromRoles,
		parseCompoundCapability
	} from '$lib/auth/roles';
	import {
		PortalMenuSections,
		PortalRolePreview,
		createPortalPreviewState,
		resolvePortalPreview,
		type PortalFeatures,
		type PortalPreviewState
	} from '$lib/features/portal';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
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

	// Station 2 depends on the selected shelter's flag; `null` while shelters load → skeleton tile.
	const features = $derived<PortalFeatures>({
		medicalScreening: sheltersQuery.isPending
			? null
			: (currentShelter?.feature_flags?.enable_medical_screening ?? false)
	});

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

	// System-admin role preview (UI-only, not persisted, dev server only): what the menu shows for
	// the previewed roles and features. Real roles/permissions and the auth store are never touched.
	let preview = $state<PortalPreviewState>(createPortalPreviewState());
	const menu = $derived(
		resolvePortalPreview({
			realRoles: roles,
			shelterCode: selectedCode,
			features,
			preview
		})
	);

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
</script>

<svelte:head>
	<title>SmartShelter</title>
</svelte:head>

<div class="flex flex-1 flex-col justify-start bg-[#F8FAFC] p-4 sm:p-6">
	<div class="mx-auto w-full max-w-7xl min-w-0 px-4 sm:px-0">
		<!-- Welcome & Operational Context Banner -->
		<section
			aria-label="บริบทการปฏิบัติงาน"
			class="mb-6 rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-xs"
		>
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<!-- Left: User Identity & Roles -->
				<div class="flex min-w-0 items-center gap-2.5">
					<div
						class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
					>
						<User class="size-4" />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span class="text-sm font-semibold text-foreground">
								สวัสดี, {displayName}
							</span>
							{#if username && username !== displayName}
								<span class="text-2xs text-muted-foreground">(@{username})</span>
							{/if}
						</div>
						<div class="mt-0.5 flex flex-wrap items-center gap-1">
							<ShieldCheck class="size-3 text-muted-foreground" />
							{#each userRoleLabels as roleLabel (roleLabel)}
								<Badge variant="secondary" class="h-5 px-1.5 text-2xs font-normal">
									{roleLabel}
								</Badge>
							{/each}
						</div>
					</div>
				</div>

				<!-- Right: Active Shelter Context & Sync Status -->
				<div class="flex flex-wrap items-center gap-2 sm:gap-3">
					<!-- Shelter context -->
					{#if canSwitchShelters && allowedShelters.length > 0}
						<div class="w-full min-w-0 sm:w-[220px]">
							<Select.Root type="single" value={selectedCode ?? ''} onValueChange={onShelterChange}>
								<Select.Trigger
									class="h-8 w-full border-border bg-background text-xs font-medium"
									aria-label="ศูนย์พักพิงที่ปฏิบัติงาน"
								>
									<div class="flex items-center gap-1.5 truncate">
										<Building2 class="size-3.5 shrink-0 text-primary" />
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
							class="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2.5 text-xs font-medium text-foreground"
							aria-label="ศูนย์พักพิงที่ปฏิบัติงาน"
						>
							<Building2 class="size-3.5 shrink-0 text-primary" />
							<span class="truncate">{currentShelter.name}</span>
							<span class="font-mono text-2xs text-muted-foreground">({currentShelter.code})</span>
						</div>
					{:else if sheltersQuery.isPending}
						<div class="inline-flex h-8 items-center gap-1.5 text-2xs text-muted-foreground">
							<RefreshCw class="size-3 animate-spin text-muted-foreground" />
							<span>กำลังโหลดศูนย์...</span>
						</div>
					{:else}
						<div
							class="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-2xs text-muted-foreground"
						>
							<Building2 class="size-3.5 text-muted-foreground" />
							<span>ไม่มีสังกัดศูนย์</span>
						</div>
					{/if}

					<div class="hidden h-6 w-px bg-border/60 sm:block" aria-hidden="true"></div>

					<!-- Sync status indicator -->
					<div class="flex h-8 items-center gap-1.5" aria-label="สถานะระบบ">
						{#if endpointStore.status === 'connected'}
							<span class="relative flex size-2">
								<span
									class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
								></span>
								<span class="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
							</span>
							<span class="text-2xs font-medium text-foreground">เชื่อมต่อแล้ว</span>
						{:else if endpointStore.status === 'connecting'}
							<span class="relative flex size-2">
								<span class="relative inline-flex size-2 animate-pulse rounded-full bg-amber-500"
								></span>
							</span>
							<span class="text-2xs font-medium text-muted-foreground">กำลังเชื่อมต่อ...</span>
						{:else}
							<span class="relative flex size-2">
								<span class="relative inline-flex size-2 rounded-full bg-rose-500"></span>
							</span>
							<span class="text-2xs font-medium text-destructive">ออฟไลน์</span>
						{/if}
					</div>
				</div>
			</div>
		</section>

		<main>
			<!-- Dev-server only: stripped from production builds (`dev` is false there). -->
			{#if dev}
				<PortalRolePreview bind:preview realRoles={roles} selectedShelterCode={selectedCode} />
			{/if}
			<PortalMenuSections
				roles={menu.roles}
				selectedShelterCode={selectedCode}
				features={menu.features}
				{username}
			/>
		</main>
	</div>
</div>
