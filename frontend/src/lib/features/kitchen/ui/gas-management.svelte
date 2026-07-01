<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { SHELTER_CODE } from '$lib/db/shelter';
	import {
		useGasCylinderTypes,
		useCreateGasCylinderType,
		useUpdateGasCylinderType,
		useDeleteGasCylinderType,
		kitchenKeys,
		type GasCylinderType
	} from '$lib/features/kitchen';
	import { useQueryClient } from '@tanstack/svelte-query';

	const gasTypes = useGasCylinderTypes();
	const createType = useCreateGasCylinderType();
	const updateType = useUpdateGasCylinderType();
	const deleteType = useDeleteGasCylinderType();
	const queryClient = useQueryClient();

	// Add form state
	let name = $state('');
	let capacityKg = $state(15);
	let burnRateKgPerHour = $state(0.5);
	let timeMultiplier = $state(1);

	// Inline edit state — keyed by doc _id
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editCapacity = $state(0);
	let editBurnRate = $state(0);
	let editMultiplier = $state(0);

	function startEdit(g: GasCylinderType) {
		editingId = g._id;
		editName = g.name;
		editCapacity = g.capacity_kg;
		editBurnRate = g.burn_rate_kg_per_hour;
		editMultiplier = g.time_multiplier;
	}

	function cancelEdit() {
		editingId = null;
	}

	async function handleSaveEdit(doc: GasCylinderType) {
		try {
			await updateType.mutateAsync({
				doc,
				input: {
					name: editName,
					capacity_kg: editCapacity,
					burn_rate_kg_per_hour: editBurnRate,
					time_multiplier: editMultiplier
				}
			});
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasCylinderTypes() });
			toast.success(`อัปเดต "${editName}" แล้ว`);
			editingId = null;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}

	async function handleDelete(doc: GasCylinderType) {
		try {
			await deleteType.mutateAsync(doc);
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasCylinderTypes() });
			toast.success(`ลบ "${doc.name}" แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const ctx = { shelterCode: SHELTER_CODE, createdBy: authStore.user?.name ?? 'staff' };
		try {
			await createType.mutateAsync({
				input: {
					name,
					capacity_kg: capacityKg,
					burn_rate_kg_per_hour: burnRateKgPerHour,
					time_multiplier: timeMultiplier
				},
				ctx
			});
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasCylinderTypes() });
			toast.success(`เพิ่ม "${name}" แล้ว`);
			name = '';
			capacityKg = 15;
			burnRateKgPerHour = 0.5;
			timeMultiplier = 1;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}
</script>

<div class="min-h-full p-6">
	<div class="mx-auto max-w-3xl space-y-5">
		<!-- Existing types card -->
		<div class="rounded-2xl bg-white p-6 shadow-sm">
			<p class="font-semibold text-gray-900">
				ฐานข้อมูลถังแก๊ส/เตาแก๊สปัจจุบัน ({gasTypes.data?.length ?? 0} ชนิด)
			</p>
			<p class="mt-0.5 text-xs text-gray-500">ค่าตั้งต้นสำหรับคำนวณเวลาและปริมาณการใช้แก๊ส</p>

			{#if gasTypes.isPending}
				<p class="mt-4 text-sm text-gray-400">กำลังโหลด...</p>
			{:else if !gasTypes.data?.length}
				<p class="mt-4 text-sm text-gray-400">ยังไม่มีข้อมูล — เพิ่มด้านล่างได้เลย</p>
			{:else}
				<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
					{#each gasTypes.data as g (g._id)}
						<div class="relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
							{#if editingId === g._id}
								<!-- Edit mode -->
								<div class="space-y-3">
									<input
										class="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-900 focus:ring-2 focus:ring-purple-400 focus:outline-none"
										bind:value={editName}
										placeholder="ชื่อประเภทเตา/แก๊ส"
									/>
									<div class="grid grid-cols-3 gap-2">
										<div class="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2">
											<p class="text-[10px] text-gray-400">ความจุ (kg)</p>
											<input
												type="number"
												min="0.1"
												step="0.1"
												class="mt-1 w-full bg-transparent text-sm font-bold text-gray-900 focus:outline-none"
												bind:value={editCapacity}
											/>
										</div>
										<div class="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2">
											<p class="text-[10px] text-gray-400">Burn Rate (kg/ชม.)</p>
											<input
												type="number"
												min="0.01"
												step="0.01"
												class="mt-1 w-full bg-transparent text-sm font-semibold text-blue-600 focus:outline-none"
												bind:value={editBurnRate}
											/>
										</div>
										<div class="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2">
											<p class="text-[10px] text-gray-400">Multiplier</p>
											<input
												type="number"
												min="0.1"
												step="0.1"
												class="mt-1 w-full bg-transparent text-sm font-bold text-purple-600 focus:outline-none"
												bind:value={editMultiplier}
											/>
										</div>
									</div>
									<div class="flex justify-end gap-2">
										<button
											type="button"
											class="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50"
											onclick={cancelEdit}
										>
											<X class="h-3 w-3" /> ยกเลิก
										</button>
										<button
											type="button"
											class="flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
											onclick={() => handleSaveEdit(g)}
											disabled={updateType.isPending || !editName}
										>
											<Check class="h-3 w-3" /> บันทึก
										</button>
									</div>
								</div>
							{:else}
								<!-- View mode -->
								<div class="absolute top-3 right-3 flex gap-1.5">
									<button
										type="button"
										class="text-gray-300 transition-colors hover:text-blue-400"
										onclick={() => startEdit(g)}
										aria-label="แก้ไข"
									>
										<Pencil class="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										class="text-gray-300 transition-colors hover:text-red-400"
										onclick={() => handleDelete(g)}
										disabled={deleteType.isPending}
										aria-label="ลบ"
									>
										<Trash2 class="h-3.5 w-3.5" />
									</button>
								</div>

								<div class="flex items-center gap-2 pr-12">
									<Flame class="h-4 w-4 shrink-0 text-orange-500" />
									<p class="text-sm font-semibold text-gray-900">{g.name}</p>
								</div>

								<div class="mt-3 grid grid-cols-3 gap-2">
									<div class="rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
										<p class="text-[10px] leading-tight text-gray-400">
											ความจุต่อถัง<br />(น้ำหนักสุทธิ)
										</p>
										<p class="mt-1.5 text-sm font-bold text-gray-900">
											{g.capacity_kg} <span class="text-xs font-normal text-gray-500">kg</span>
										</p>
									</div>
									<div class="rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
										<p class="text-[10px] leading-tight text-gray-400">
											อัตราสิ้นเปลือง<br />(Burn Rate)
										</p>
										<p class="mt-1.5 text-sm font-semibold text-blue-600">
											{g.burn_rate_kg_per_hour}<span class="text-xs font-normal"> kg / ชม.</span>
										</p>
									</div>
									<div class="rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
										<p class="text-[10px] leading-tight text-gray-400">
											ตัวคูณเวลา<br />(Time Multiplier)
										</p>
										<p class="mt-1.5 text-sm font-bold text-purple-600">x{g.time_multiplier}</p>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Add form card -->
		<div class="rounded-2xl bg-white p-6 shadow-sm">
			<p class="flex items-center gap-1.5 font-semibold text-gray-900">
				<Plus class="h-4 w-4" />
				เพิ่มรายการเตา/ถังแก๊สใหม่
			</p>

			<form onsubmit={handleSubmit} class="mt-4 space-y-4">
				<div class="space-y-1.5">
					<Label for="gas-name" class="text-sm text-gray-700">ชื่อประเภทเตา/แก๊ส</Label>
					<Input
						id="gas-name"
						placeholder="เช่น เตาแก๊สแรงดันสูง + ถัง 15kg"
						bind:value={name}
						required
						class="rounded-lg border-gray-200"
					/>
				</div>

				<div class="grid grid-cols-3 gap-4">
					<div class="space-y-1.5">
						<Label for="gas-capacity" class="text-sm text-gray-700"
							>น้ำหนักแก๊สเติมต่อถัง (kg)</Label
						>
						<Input
							id="gas-capacity"
							type="number"
							min="0.1"
							step="0.1"
							bind:value={capacityKg}
							required
							class="rounded-lg border-gray-200"
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="gas-burn" class="text-sm text-gray-700">อัตราสิ้นเปลือง (kg/ชม.)</Label>
						<Input
							id="gas-burn"
							type="number"
							min="0.01"
							step="0.01"
							bind:value={burnRateKgPerHour}
							required
							class="rounded-lg border-gray-200"
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="gas-mult" class="text-sm text-gray-700">ตัวคูณเวลา (Time Multiplier)</Label>
						<Input
							id="gas-mult"
							type="number"
							min="0.1"
							step="0.1"
							bind:value={timeMultiplier}
							required
							class="rounded-lg border-gray-200"
						/>
					</div>
				</div>

				<div class="flex justify-end">
					<Button
						type="submit"
						disabled={createType.isPending || !name}
						class="rounded-full bg-purple-600 px-6 text-white hover:bg-purple-700"
					>
						{createType.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าแก๊ส'}
					</Button>
				</div>
			</form>
		</div>
	</div>
</div>
