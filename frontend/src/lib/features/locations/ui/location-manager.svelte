<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import {
		useProvinces,
		useDistricts,
		useSubdistricts,
		useCreateProvince,
		useCreateDistrict,
		useCreateSubdistrict,
		useUpdateZipcode,
		useDeleteLocation,
		locationKeys,
		provinceDocId,
		districtDocId,
		subdistrictDocId
	} from '$lib/features/locations';

	let selectedProvince = $state<string | null>(null);
	let selectedDistrict = $state<string | null>(null);

	const provinces = useProvinces();
	const districts = useDistricts(() => selectedProvince);
	const subdistricts = useSubdistricts(
		() => selectedProvince,
		() => selectedDistrict
	);

	const createProvince = useCreateProvince();
	const createDistrict = useCreateDistrict();
	const createSubdistrict = useCreateSubdistrict();
	const updateZipcode = useUpdateZipcode();
	const deleteLocation = useDeleteLocation();

	let newProvince = $state('');
	let newDistrict = $state('');
	let newSubdistrict = $state('');
	let newZipcode = $state('');
	let editingZipId = $state<string | null>(null);
	let editingZipValue = $state('');

	function selectProvince(name: string) {
		selectedProvince = name;
		selectedDistrict = null;
	}

	function addProvince() {
		const name = newProvince.trim();
		if (!name) return;
		createProvince.mutate(name, { onSuccess: () => (newProvince = '') });
	}

	function addDistrict() {
		const name = newDistrict.trim();
		if (!name || !selectedProvince) return;
		createDistrict.mutate(
			{ province: selectedProvince, name },
			{ onSuccess: () => (newDistrict = '') }
		);
	}

	function addSubdistrict() {
		const name = newSubdistrict.trim();
		const zip = Number(newZipcode);
		if (!name || !selectedProvince || !selectedDistrict) return;
		createSubdistrict.mutate(
			{ province: selectedProvince, district: selectedDistrict, name, zipcode: zip },
			{
				onSuccess: () => {
					newSubdistrict = '';
					newZipcode = '';
				}
			}
		);
	}

	function saveZip(subdistrict: string) {
		if (!selectedProvince || !selectedDistrict) return;
		updateZipcode.mutate(
			{
				id: subdistrictDocId(selectedProvince, selectedDistrict, subdistrict),
				zipcode: Number(editingZipValue),
				province: selectedProvince,
				district: selectedDistrict
			},
			{ onSuccess: () => (editingZipId = null) }
		);
	}
</script>

<div class="grid gap-4 md:grid-cols-3">
	<!-- Provinces -->
	<Card>
		<CardHeader>
			<CardTitle>จังหวัด</CardTitle>
		</CardHeader>
		<CardContent class="space-y-3">
			<div class="flex gap-2">
				<Input
					bind:value={newProvince}
					placeholder="เพิ่มจังหวัด"
					onkeydown={(e) => e.key === 'Enter' && addProvince()}
				/>
				<Button
					size="icon"
					variant="secondary"
					onclick={addProvince}
					disabled={createProvince.isPending}
				>
					<Plus class="size-4" />
				</Button>
			</div>
			<ScrollArea class="h-[60vh] pr-2">
				<ul class="space-y-1">
					{#each provinces.data ?? [] as province (province)}
						<li class="flex items-center gap-1">
							<button
								class="flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted {selectedProvince ===
								province
									? 'bg-muted font-medium'
									: ''}"
								onclick={() => selectProvince(province)}
							>
								<span>{province}</span>
								<ChevronRight class="size-4 opacity-50" />
							</button>
							<Button
								size="icon"
								variant="ghost"
								onclick={() =>
									deleteLocation.mutate({
										id: provinceDocId(province),
										invalidate: locationKeys.provinces()
									})}
							>
								<Trash2 class="size-4 text-destructive" />
							</Button>
						</li>
					{:else}
						<li class="px-2 py-4 text-sm text-muted-foreground">
							{provinces.isLoading ? 'กำลังโหลด…' : 'ยังไม่มีข้อมูล'}
						</li>
					{/each}
				</ul>
			</ScrollArea>
		</CardContent>
	</Card>

	<!-- Districts -->
	<Card>
		<CardHeader>
			<CardTitle>อำเภอ / เขต</CardTitle>
		</CardHeader>
		<CardContent class="space-y-3">
			{#if selectedProvince}
				<div class="flex gap-2">
					<Input
						bind:value={newDistrict}
						placeholder="เพิ่มอำเภอใน {selectedProvince}"
						onkeydown={(e) => e.key === 'Enter' && addDistrict()}
					/>
					<Button
						size="icon"
						variant="secondary"
						onclick={addDistrict}
						disabled={createDistrict.isPending}
					>
						<Plus class="size-4" />
					</Button>
				</div>
				<ScrollArea class="h-[60vh] pr-2">
					<ul class="space-y-1">
						{#each districts.data ?? [] as district (district)}
							<li class="flex items-center gap-1">
								<button
									class="flex flex-1 items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted {selectedDistrict ===
									district
										? 'bg-muted font-medium'
										: ''}"
									onclick={() => (selectedDistrict = district)}
								>
									<span>{district}</span>
									<ChevronRight class="size-4 opacity-50" />
								</button>
								<Button
									size="icon"
									variant="ghost"
									onclick={() =>
										deleteLocation.mutate({
											id: districtDocId(selectedProvince!, district),
											invalidate: locationKeys.districts(selectedProvince!)
										})}
								>
									<Trash2 class="size-4 text-destructive" />
								</Button>
							</li>
						{:else}
							<li class="px-2 py-4 text-sm text-muted-foreground">
								{districts.isLoading ? 'กำลังโหลด…' : 'ยังไม่มีอำเภอ'}
							</li>
						{/each}
					</ul>
				</ScrollArea>
			{:else}
				<p class="px-2 py-4 text-sm text-muted-foreground">เลือกจังหวัดก่อน</p>
			{/if}
		</CardContent>
	</Card>

	<!-- Subdistricts -->
	<Card>
		<CardHeader>
			<CardTitle>ตำบล / แขวง</CardTitle>
		</CardHeader>
		<CardContent class="space-y-3">
			{#if selectedProvince && selectedDistrict}
				<div class="flex gap-2">
					<Input bind:value={newSubdistrict} placeholder="ชื่อตำบล" />
					<Input
						bind:value={newZipcode}
						placeholder="รหัสไปรษณีย์"
						inputmode="numeric"
						class="w-32"
					/>
					<Button
						size="icon"
						variant="secondary"
						onclick={addSubdistrict}
						disabled={createSubdistrict.isPending}
					>
						<Plus class="size-4" />
					</Button>
				</div>
				<ScrollArea class="h-[60vh] pr-2">
					<ul class="space-y-1">
						{#each subdistricts.data ?? [] as sub (sub.subdistrict)}
							<li class="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
								<span class="flex-1">{sub.subdistrict}</span>
								{#if editingZipId === sub.subdistrict}
									<Input
										bind:value={editingZipValue}
										inputmode="numeric"
										class="h-7 w-24"
										onkeydown={(e) => e.key === 'Enter' && saveZip(sub.subdistrict)}
									/>
									<Button size="sm" variant="secondary" onclick={() => saveZip(sub.subdistrict)}
										>บันทึก</Button
									>
								{:else}
									<button
										class="flex items-center gap-1 rounded px-1 text-muted-foreground tabular-nums hover:text-foreground"
										onclick={() => {
											editingZipId = sub.subdistrict;
											editingZipValue = String(sub.zipcode);
										}}
									>
										{sub.zipcode}
										<Pencil class="size-3" />
									</button>
								{/if}
								<Button
									size="icon"
									variant="ghost"
									onclick={() =>
										deleteLocation.mutate({
											id: subdistrictDocId(selectedProvince!, selectedDistrict!, sub.subdistrict),
											invalidate: locationKeys.subdistricts(selectedProvince!, selectedDistrict!)
										})}
								>
									<Trash2 class="size-4 text-destructive" />
								</Button>
							</li>
						{:else}
							<li class="px-2 py-4 text-sm text-muted-foreground">
								{subdistricts.isLoading ? 'กำลังโหลด…' : 'ยังไม่มีตำบล'}
							</li>
						{/each}
					</ul>
				</ScrollArea>
			{:else}
				<p class="px-2 py-4 text-sm text-muted-foreground">เลือกอำเภอก่อน</p>
			{/if}
		</CardContent>
	</Card>
</div>
