<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	const sheltersQuery = useShelters();

	const selectedCode = $derived(shelterStore.selectedShelterCode ?? shelterStore.listDefaultCode);

	// Set after the query resolves — doing this inside listShelters() used to
	// change getShelterDb() mid-fetch and trigger queryClient.clear() on F5.
	$effect(() => {
		const shelters = sheltersQuery.data;
		if (shelters?.length && !shelterStore.listDefaultCode) {
			shelterStore.listDefaultCode = shelters[0].code;
		}
	});

	function onShelterChange(code: string | undefined) {
		if (code) shelterStore.selectedShelterCode = code;
	}
</script>

<nav
	class="flex h-[52px] w-full items-center justify-center bg-[#0A2647] px-6 text-white shadow-sm"
>
	<div class="flex items-center">
		{#if sheltersQuery.isPending}
			<span class="pr-4 text-sm font-medium text-white/80">กำลังโหลด...</span>
		{:else if sheltersQuery.isError}
			<span class="pr-4 text-sm font-medium text-red-400">เกิดข้อผิดพลาดในการโหลดข้อมูล</span>
		{:else if sheltersQuery.data}
			<Select.Root type="single" value={selectedCode ?? ''} onValueChange={onShelterChange}>
				<Select.Trigger
					class="w-auto min-w-[250px] border-none bg-transparent text-sm font-medium text-white shadow-none hover:bg-white/5 focus:ring-0 focus-visible:ring-0 [&_svg]:text-white/80"
				>
					{sheltersQuery.data.find((s) => s.code === selectedCode)?.name ?? 'เลือกศูนย์พักพิง'}
				</Select.Trigger>
				<Select.Content align="end" class="w-[350px]">
					<Select.Group>
						{#each sheltersQuery.data as shelter (shelter.code)}
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
