<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	const sheltersQuery = useShelters();

	// เมื่อโหลดข้อมูลเสร็จและยังไม่ได้เลือก ให้เลือกอันแรกเป็นค่าเริ่มต้น
	$effect(() => {
		if (sheltersQuery.data && sheltersQuery.data.length > 0 && !shelterStore.selectedShelterCode) {
			shelterStore.selectedShelterCode = sheltersQuery.data[0].code;
		}
	});
</script>

<nav class="flex h-[52px] w-full items-center justify-center bg-[#0A2647] px-6 text-white shadow-sm">
	<div class="flex items-center">
		{#if sheltersQuery.isLoading}
			<span class="text-sm font-medium text-white/80 pr-4">กำลังโหลด...</span>
		{:else if sheltersQuery.isError}
			<span class="text-sm font-medium text-red-400 pr-4">เกิดข้อผิดพลาดในการโหลดข้อมูล</span>
		{:else if sheltersQuery.data}
			<Select.Root type="single" bind:value={shelterStore.selectedShelterCode}>
				<Select.Trigger
					class="w-auto min-w-[250px] border-none bg-transparent text-sm font-medium text-white shadow-none hover:bg-white/5 focus:ring-0 focus-visible:ring-0 [&_svg]:text-white/80"
				>
					{sheltersQuery.data.find((s) => s.code === shelterStore.selectedShelterCode)?.name ?? 'เลือกศูนย์พักพิง'}
				</Select.Trigger>
				<Select.Content align="end" class="w-[350px]">
					<Select.Group>
						{#each sheltersQuery.data as shelter}
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
