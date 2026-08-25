<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Fuel from '@lucide/svelte/icons/fuel';
	import Eraser from '@lucide/svelte/icons/eraser';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Table from '$lib/components/ui/table';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useGasCylinderTypes,
		useCreateGasCylinderType,
		useUpdateGasCylinderType,
		useDeleteGasCylinderType,
		useGasLedger,
		useRefillGasCylinder,
		useWriteOffGasCylinder,
		gasCylinderBalance,
		gasCylinderStatus,
		maxRefillKg,
		kitchenKeys,
		type GasCylinderType,
		type GasCylinderStatus
	} from '$lib/features/kitchen';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { addQty, qtyNeg } from '$lib/utils/qty';

	const gasTypes = useGasCylinderTypes();
	const gasLedger = useGasLedger();
	const createType = useCreateGasCylinderType();
	const updateType = useUpdateGasCylinderType();
	const deleteType = useDeleteGasCylinderType();
	const refillType = useRefillGasCylinder();
	const writeOffType = useWriteOffGasCylinder();
	const queryClient = useQueryClient();

	const GAS_STATUS_LABELS: Record<GasCylinderStatus, string> = {
		unused: 'ยังไม่ใช้',
		in_use: 'กำลังใช้',
		empty: 'หมดแล้ว'
	};
	const GAS_STATUS_CLASS: Record<GasCylinderStatus, string> = {
		unused: 'border-border bg-muted text-muted-foreground',
		in_use: 'border-blue-200 bg-blue-50 text-blue-700',
		empty: 'border-red-200 bg-red-50 text-red-700'
	};

	// Remaining kg for one cylinder — computed from its ledger, never stored (CR-085).
	function remainingOf(g: GasCylinderType): string {
		return gasCylinderBalance(gasLedger.data ?? [], g._id, g.capacity_kg);
	}

	// Refill dialog state
	let refillOpen = $state(false);
	let refillDoc = $state<GasCylinderType | null>(null);
	let refillQty = $state('');
	const refillRoom = $derived(
		refillDoc ? maxRefillKg(remainingOf(refillDoc), refillDoc.capacity_kg) : '0'
	);

	function startRefill(g: GasCylinderType) {
		refillDoc = g;
		refillQty = '';
		refillOpen = true;
	}

	function closeRefill() {
		refillOpen = false;
		refillDoc = null;
		refillQty = '';
	}

	async function handleRefill() {
		if (!refillDoc) return;
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			await refillType.mutateAsync({ cylinderId: refillDoc._id, qtyKg: refillQty, ctx });
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasLedger() });
			toast.success(`เติมแก๊ส "${refillDoc.name}" ${refillQty} kg แล้ว`);
			closeRefill();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}

	// Write-off (CR-085 addendum) — a dust-sized remainder can never reach 0
	// through consumption (gas draws are a hard all-or-nothing block, unlike
	// stock_ledger's partial issue), so it needs a manual way to zero out.
	let writeOffOpen = $state(false);
	let writeOffDoc = $state<GasCylinderType | null>(null);

	function startWriteOff(g: GasCylinderType) {
		writeOffDoc = g;
		writeOffOpen = true;
	}

	async function handleWriteOff() {
		if (!writeOffDoc) return;
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
		try {
			await writeOffType.mutateAsync({ cylinderId: writeOffDoc._id, ctx });
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasLedger() });
			toast.success(`ตัดเศษเหลือของ "${writeOffDoc.name}" เป็น 0 แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		} finally {
			writeOffOpen = false;
			writeOffDoc = null;
		}
	}

	// Add form state
	let name = $state('');
	let capacityKg = $state('15');
	let burnRateKgPerHour = $state('0.5');
	let timeMultiplier = $state('1');

	// Edit dialog state — the row being edited, or null when the dialog is closed.
	let editOpen = $state(false);
	let editingDoc = $state<GasCylinderType | null>(null);
	let editName = $state('');
	let editCapacity = $state('0');
	let editBurnRate = $state('0');
	let editMultiplier = $state('0');

	function startEdit(g: GasCylinderType) {
		editingDoc = g;
		editName = g.name;
		editCapacity = g.capacity_kg;
		editBurnRate = g.burn_rate_kg_per_hour;
		editMultiplier = g.time_multiplier;
		editOpen = true;
	}

	function closeEdit() {
		editOpen = false;
		editingDoc = null;
	}

	async function handleSaveEdit() {
		if (!editingDoc) return;
		try {
			await updateType.mutateAsync({
				doc: editingDoc,
				input: {
					name: editName,
					capacity_kg: editCapacity,
					burn_rate_kg_per_hour: editBurnRate,
					time_multiplier: editMultiplier
				}
			});
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasCylinderTypes() });
			toast.success(`อัปเดต "${editName}" แล้ว`);
			closeEdit();
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
		const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
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
			capacityKg = '15';
			burnRateKgPerHour = '0.5';
			timeMultiplier = '1';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
		}
	}
</script>

<div class="min-h-full p-6">
	<div class="mx-auto max-w-3xl space-y-5">
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
							type="text"
							inputmode="decimal"
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
							type="text"
							inputmode="decimal"
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
							type="text"
							inputmode="decimal"
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
				<div class="mt-4 overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>ชื่อประเภทเตา/แก๊ส</Table.Head>
								<Table.Head class="text-right">ความจุต่อถัง (kg)</Table.Head>
								<Table.Head class="text-right">Burn Rate (kg/ชม.)</Table.Head>
								<Table.Head class="text-right">ตัวคูณเวลา</Table.Head>
								<Table.Head>สถานะ</Table.Head>
								<Table.Head class="text-right">ใช้ไปแล้ว</Table.Head>
								<Table.Head class="text-right">เหลือ</Table.Head>
								<Table.Head class="text-right">จัดการ</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each gasTypes.data as g (g._id)}
								{@const remaining = remainingOf(g)}
								{@const status = gasCylinderStatus(remaining, g.capacity_kg)}
								{@const used = addQty(g.capacity_kg, qtyNeg(remaining))}
								<Table.Row>
									<Table.Cell>
										<div class="flex items-center gap-2">
											<Flame class="h-4 w-4 shrink-0 text-orange-500" />
											<span class="font-medium text-gray-900">{g.name}</span>
										</div>
									</Table.Cell>
									<Table.Cell class="text-right">{g.capacity_kg} kg</Table.Cell>
									<Table.Cell class="text-right text-blue-600"
										>{g.burn_rate_kg_per_hour} kg/ชม.</Table.Cell
									>
									<Table.Cell class="text-right text-purple-600">x{g.time_multiplier}</Table.Cell>
									<Table.Cell>
										<Badge variant="outline" class={GAS_STATUS_CLASS[status]}
											>{GAS_STATUS_LABELS[status]}</Badge
										>
									</Table.Cell>
									<Table.Cell class="text-right">{used} kg</Table.Cell>
									<Table.Cell class="text-right font-medium">{remaining} kg</Table.Cell>
									<Table.Cell class="text-right">
										<div class="flex justify-end gap-1.5">
											<button
												type="button"
												class="text-gray-400 transition-colors hover:text-emerald-500"
												onclick={() => startRefill(g)}
												disabled={status === 'unused'}
												aria-label="เติมแก๊ส"
											>
												<Fuel class="h-4 w-4" />
											</button>
											<button
												type="button"
												class="text-gray-400 transition-colors hover:text-amber-500"
												onclick={() => startWriteOff(g)}
												disabled={status !== 'in_use'}
												title="ตัดเศษเหลือทิ้ง — ใช้เมื่อถังเหลือน้อยเกินจะเบิกอีก"
												aria-label="ตัดเศษเหลือทิ้ง"
											>
												<Eraser class="h-4 w-4" />
											</button>
											<button
												type="button"
												class="text-gray-400 transition-colors hover:text-blue-500"
												onclick={() => startEdit(g)}
												aria-label="แก้ไข"
											>
												<Pencil class="h-4 w-4" />
											</button>
											<button
												type="button"
												class="text-gray-400 transition-colors hover:text-red-500"
												onclick={() => handleDelete(g)}
												disabled={deleteType.isPending}
												aria-label="ลบ"
											>
												<Trash2 class="h-4 w-4" />
											</button>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</div>

		<Dialog.Root open={editOpen} onOpenChange={(v) => (v ? null : closeEdit())}>
			<Dialog.Content class="sm:max-w-md">
				<Dialog.Header>
					<Dialog.Title>แก้ไขถังแก๊ส/เตาแก๊ส</Dialog.Title>
				</Dialog.Header>
				<div class="space-y-4">
					<div class="space-y-1.5">
						<Label for="gas-edit-name">ชื่อประเภทเตา/แก๊ส</Label>
						<Input id="gas-edit-name" bind:value={editName} />
					</div>
					<div class="grid grid-cols-3 gap-3">
						<div class="space-y-1.5">
							<Label for="gas-edit-capacity" class="text-xs">ความจุ (kg)</Label>
							<Input
								id="gas-edit-capacity"
								type="text"
								inputmode="decimal"
								bind:value={editCapacity}
							/>
						</div>
						<div class="space-y-1.5">
							<Label for="gas-edit-burn" class="text-xs">Burn Rate (kg/ชม.)</Label>
							<Input id="gas-edit-burn" type="text" inputmode="decimal" bind:value={editBurnRate} />
						</div>
						<div class="space-y-1.5">
							<Label for="gas-edit-mult" class="text-xs">ตัวคูณเวลา</Label>
							<Input
								id="gas-edit-mult"
								type="text"
								inputmode="decimal"
								bind:value={editMultiplier}
							/>
						</div>
					</div>
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={closeEdit}>ยกเลิก</Button>
					<Button onclick={handleSaveEdit} disabled={updateType.isPending || !editName}>
						{updateType.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>

		<Dialog.Root open={refillOpen} onOpenChange={(v) => (v ? null : closeRefill())}>
			<Dialog.Content class="sm:max-w-sm">
				<Dialog.Header>
					<Dialog.Title>เติมแก๊ส{refillDoc ? ` — ${refillDoc.name}` : ''}</Dialog.Title>
					{#if refillDoc}
						<Dialog.Description>
							เหลือ {remainingOf(refillDoc)} kg จาก {refillDoc.capacity_kg} kg — เติมได้อีกไม่เกิน
							{refillRoom} kg
						</Dialog.Description>
					{/if}
				</Dialog.Header>
				<div class="space-y-1.5">
					<Label for="gas-refill-qty">ปริมาณที่เติม (kg)</Label>
					<Input id="gas-refill-qty" type="text" inputmode="decimal" bind:value={refillQty} />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={closeRefill}>ยกเลิก</Button>
					<Button onclick={handleRefill} disabled={refillType.isPending || !refillQty}>
						{refillType.isPending ? 'กำลังบันทึก...' : 'เติมแก๊ส'}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>

		<AlertDialog.Root bind:open={writeOffOpen}>
			<AlertDialog.Content>
				<AlertDialog.Header>
					<AlertDialog.Title>ตัดเศษเหลือทิ้ง?</AlertDialog.Title>
					<AlertDialog.Description>
						{#if writeOffDoc}
							ถัง "{writeOffDoc.name}" เหลือ {remainingOf(writeOffDoc)} kg — เศษจำนวนนี้เบิกต่อไม่ได้
							(เบิกแก๊สบางส่วนไม่ได้) การตัดเศษจะปรับยอดเหลือเป็น 0 กก. ทันที (บันทึกเป็นรายการ ปรับยอดใน
							ledger, กู้คืนไม่ได้ — เติมแก๊สใหม่ได้ตามปกติ)
						{/if}
					</AlertDialog.Description>
				</AlertDialog.Header>
				<AlertDialog.Footer>
					<AlertDialog.Cancel onclick={() => (writeOffDoc = null)}>ยกเลิก</AlertDialog.Cancel>
					<AlertDialog.Action
						class="bg-amber-600 text-white hover:bg-amber-700"
						disabled={writeOffType.isPending}
						onclick={handleWriteOff}
					>
						ตัดเศษเหลือทิ้ง
					</AlertDialog.Action>
				</AlertDialog.Footer>
			</AlertDialog.Content>
		</AlertDialog.Root>
	</div>
</div>
