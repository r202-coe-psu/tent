<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore, persistSelectedShelter } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterCodesFromRoles, isSystemAdmin } from '$lib/auth/roles';

	const sheltersQuery = useShelters();

	const selectedCode = $derived(shelterStore.selectedShelterCode);

	const userShelterCodes = $derived(shelterCodesFromRoles(authStore.user?.roles ?? []));
	const isAdmin = $derived(isSystemAdmin(authStore.user?.roles ?? []));

	const allowedShelters = $derived(
		sheltersQuery.data?.filter((s) => isAdmin || userShelterCodes.includes(s.code)) ?? []
	);

	const selectedShelterName = $derived(
		allowedShelters.find((s) => s.code === selectedCode)?.name ?? 'เลือกศูนย์พักพิง'
	);

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
</script>

<nav
	class="flex h-[52px] w-full items-center justify-between gap-3 bg-[#0A2647] px-6 text-white shadow-sm"
>
	<div class="flex min-w-0 shrink items-center gap-2.5">
		<img src="/logo.png" alt="PSU Smart Shelter" class="h-8 w-8 shrink-0" />
		<span class="hidden truncate text-sm font-medium text-white sm:inline">PSU Smart Shelter</span>
	</div>

	<div class="flex min-w-0 items-center">
		{#if sheltersQuery.isPending}
			<span class="pr-4 text-sm font-medium text-white/80">กำลังโหลด...</span>
		{:else if sheltersQuery.isError}
			<span class="pr-4 text-sm font-medium text-red-400">เกิดข้อผิดพลาดในการโหลดข้อมูล</span>
		{:else if sheltersQuery.data}
			<Select.Root type="single" value={selectedCode ?? ''} onValueChange={onShelterChange}>
				<Select.Trigger
					class="h-11 min-h-11 w-full max-w-[min(100%,20rem)] min-w-0 border-none bg-transparent text-sm font-medium text-white shadow-none hover:bg-white/5 focus:ring-0 focus-visible:ring-0 sm:min-w-[12rem] [&_svg]:text-white/80"
				>
					<span class="truncate">{selectedShelterName}</span>
				</Select.Trigger>
				<Select.Content align="end" class="w-[min(100vw-2rem,22rem)]">
					<Select.Group>
						{#each allowedShelters as shelter (shelter.code)}
							<Select.Item value={shelter.code} label={shelter.name}>
								{shelter.name}
							</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		{/if}
	</div>
</nav>
