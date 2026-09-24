<script lang="ts">
	import { Select, SelectTrigger, SelectContent, SelectItem } from '$lib/components/ui/select';
	import Building from '@lucide/svelte/icons/building';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore, persistSelectedShelter } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, shelterCodesFromRoles } from '$lib/auth/roles';
	import { cn } from '$lib/utils/shadcn';

	type Props = {
		/** Icon-only trigger for the collapsed desktop sidebar */
		compact?: boolean;
		class?: string;
	};

	let { compact = false, class: className }: Props = $props();

	const sheltersQuery = useShelters();

	function shelterLabel(code: string, name: string) {
		return `${code} — ${name}`;
	}

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const userShelterCodes = $derived(shelterCodesFromRoles(roles));

	const availableShelters = $derived.by(() => {
		const allShelters = sheltersQuery.data ?? [];
		if (isSA) return allShelters;
		if (userShelterCodes.length > 0) {
			return allShelters.filter((s) => userShelterCodes.includes(s.code));
		}
		return [];
	});

	// Prefer persisted selection when still allowed; else first assigned shelter.
	$effect(() => {
		const shelters = availableShelters;
		if (shelters.length === 0) return;
		const current = shelterStore.selectedShelterCode;
		if (current && shelters.some((s) => s.code === current)) {
			persistSelectedShelter(current);
			return;
		}
		const preferred =
			shelters.find((s) => userShelterCodes.includes(s.code))?.code ?? shelters[0].code;
		shelterStore.selectedShelterCode = preferred;
		persistSelectedShelter(preferred);
	});

	const selectedShelter = $derived(
		availableShelters.find((s) => s.code === shelterStore.selectedShelterCode)
	);
	const selectedShelterLabel = $derived(
		selectedShelter
			? shelterLabel(selectedShelter.code, selectedShelter.name)
			: (shelterStore.selectedShelterCode ?? 'เลือกศูนย์อพยพ')
	);
</script>

<div class={cn('flex min-w-0 flex-col gap-1.5', className)}>
	{#if !compact}
		<span class="px-0.5 text-2xs font-bold tracking-wider text-muted-foreground/70 uppercase">
			ศูนย์อพยพ
		</span>
	{/if}
	<Select type="single" bind:value={shelterStore.selectedShelterCode}>
		<SelectTrigger
			class={cn(
				'h-11 min-h-11',
				compact
					? 'w-11 justify-center px-0 [&_svg:last-child]:hidden'
					: 'w-full'
			)}
			aria-label="เลือกศูนย์อพยพ"
			title={compact ? selectedShelterLabel : undefined}
		>
			{#if compact}
				<Building class="size-4 shrink-0 text-muted-foreground" />
			{:else}
				<span class="truncate">{selectedShelterLabel}</span>
			{/if}
		</SelectTrigger>
		<SelectContent>
			{#if sheltersQuery.isLoading}
				<SelectItem value="" disabled label="กำลังโหลด..." />
			{:else if availableShelters.length === 0}
				<SelectItem value="" disabled label="ไม่มีศูนย์พักพิงที่เข้าถึงได้" />
			{:else}
				{#each availableShelters as shelter (shelter.code)}
					<SelectItem
						value={shelter.code}
						label={shelterLabel(shelter.code, shelter.name)}
					/>
				{/each}
			{/if}
		</SelectContent>
	</Select>
</div>
