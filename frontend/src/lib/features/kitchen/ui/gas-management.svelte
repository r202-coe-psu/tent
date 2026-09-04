<script lang="ts">
	import Flame from '@lucide/svelte/icons/flame';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Fuel from '@lucide/svelte/icons/fuel';
	import Eraser from '@lucide/svelte/icons/eraser';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Form from '$lib/components/ui/form/index.js';
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
		gasCylinderTypeInputSchema,
		type GasCylinderType,
		type GasCylinderStatus
	} from '$lib/features/kitchen';
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { useQueryClient } from '@tanstack/svelte-query';

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
		in_use:
			'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
		empty:
			'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
	};

	// Compute remaining gas balance from ledger.
	function remainingOf(g: GasCylinderType): string {
		return gasCylinderBalance(gasLedger.data ?? [], g._id, g.capacity_kg);
	}

	const gasList = $derived(gasTypes.data ?? []);

	const stats = $derived.by(() => {
		const ledger = gasLedger.data ?? [];
		let inUseCount = 0;
		let unusedCount = 0;
		let emptyCount = 0;
		let totalRemaining = 0;
		let totalCapacity = 0;

		for (const g of gasList) {
			const remStr = gasCylinderBalance(ledger, g._id, g.capacity_kg);
			const rem = parseFloat(remStr) || 0;
			const cap = parseFloat(g.capacity_kg) || 0;
			const st = gasCylinderStatus(remStr, g.capacity_kg);
			if (st === 'in_use') inUseCount++;
			else if (st === 'empty') emptyCount++;
			else unusedCount++;

			totalRemaining += rem;
			totalCapacity += cap;
		}

		const totalUsed = Math.max(0, totalCapacity - totalRemaining);

		return {
			totalTypes: gasList.length,
			inUseCount,
			unusedCount,
			emptyCount,
			totalRemaining: totalRemaining.toFixed(1),
			totalUsed: totalUsed.toFixed(1)
		};
	});

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

	// Write-off dialog state to zero out remaining balance.
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

	let createOpen = $state(false);

	// Add form with Superforms
	const form = superForm(
		defaults(
			{
				name: '',
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.5',
				time_multiplier: '1'
			},
			zod4(gasCylinderTypeInputSchema)
		),
		{
			SPA: true,
			validators: zod4(gasCylinderTypeInputSchema),
			resetForm: true,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) return;
				const ctx = { shelterCode: getShelterCode(), createdBy: authStore.user?.name ?? 'staff' };
				try {
					await createType.mutateAsync({
						input: validated.data,
						ctx
					});
					await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasCylinderTypes() });
					toast.success(`เพิ่ม "${validated.data.name}" แล้ว`);
					createOpen = false;
				} catch (err) {
					toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
				}
			}
		}
	);
	const { form: formData, enhance, submitting } = form;

	// Edit dialog state.
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
		if (!confirm(`คุณต้องการลบรายการ "${doc.name}" หรือไม่?`)) return;
		try {
			await deleteType.mutateAsync(doc);
			await queryClient.invalidateQueries({ queryKey: kitchenKeys.gasCylinderTypes() });
			toast.success(`ลบ "${doc.name}" แล้ว`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
		}
	}
</script>

<div class="mx-auto space-y-6 p-4">
	<!-- Top Navigation Breadcrumb & Header -->
	<div class="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/back-office/kitchen')}
				class="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
				aria-label="กลับสู่ครัวกลาง"
			>
				<ArrowLeft class="h-4 w-4" />
			</a>
			<div
				class="rounded-lg bg-orange-100 p-2 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
			>
				<Flame class="h-5 w-5" />
			</div>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-base font-bold text-foreground sm:text-lg">
						จัดการทรัพยากรแก๊สสำหรับโรงครัว
					</h1>
					<Badge variant="outline" class="font-normal text-muted-foreground">
						{gasTypes.data?.length ?? 0} รายการ
					</Badge>
				</div>
				<p class="text-xs text-muted-foreground">
					ตั้งค่าอัตราการสิ้นเปลืองเชื้อเพลิง (Burn Rate)
					และบันทึกปริมาณการใช้/เติมแก๊สของเตาแต่ละประเภท
				</p>
			</div>
		</div>

		<div>
			<Button onclick={() => (createOpen = true)} class="gap-1.5 shadow-xs">
				<Plus class="h-4 w-4" />
				เพิ่มรายการเตา/ถังแก๊ส
			</Button>
		</div>
	</div>

	<!-- Stats Summary KPIs -->
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">ประเภทเตา/ถังแก๊ส</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-foreground">{stats.totalTypes}</p>
			<p class="mt-0.5 text-xs text-muted-foreground">รายการที่ลงทะเบียน</p>
		</div>
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">สถานะการใช้งาน</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-foreground">
				<span class="text-blue-600 dark:text-blue-400">{stats.inUseCount}</span>
				<span class="text-sm font-normal text-muted-foreground">/ {stats.totalTypes} กำลังใช้</span>
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">ยังไม่ใช้ {stats.unusedCount} ถัง</p>
		</div>
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">ปริมาณแก๊สคงเหลือรวม</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
				{stats.totalRemaining}
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">กิโลกรัม (kg)</p>
		</div>
		<div class="rounded-xl border bg-card p-4 shadow-sm">
			<p class="text-xs font-medium text-muted-foreground">ปริมาณแก๊สที่ใช้ไปรวม</p>
			<p class="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
				{stats.totalUsed}
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">กิโลกรัม (kg)</p>
		</div>
	</div>

	<!-- Existing types card -->
	<Card.Root class="border shadow-sm">
		<Card.Header
			class="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<div class="flex items-center gap-2">
					<Card.Title class="text-base font-semibold">ฐานข้อมูลถังแก๊ส/เตาแก๊สปัจจุบัน</Card.Title>
					<Badge variant="secondary" class="font-mono">{gasTypes.data?.length ?? 0}</Badge>
				</div>
				<Card.Description class="text-xs">
					ค่าตั้งต้นสำหรับคำนวณเวลาและปริมาณการใช้แก๊ส พร้อมบันทึกประวัติสถานะและยอดคงเหลือล่าสุด
				</Card.Description>
			</div>
			<div>
				<Button onclick={() => (createOpen = true)} size="sm" class="gap-1.5 shadow-xs">
					<Plus class="h-3.5 w-3.5" />
					เพิ่มเตา/ถังแก๊ส
				</Button>
			</div>
		</Card.Header>
		<Card.Content class="p-0">
			{#if gasTypes.isPending}
				<div class="py-12 text-center text-sm text-muted-foreground">กำลังโหลดข้อมูล...</div>
			{:else if !gasTypes.data?.length}
				<div class="py-12 text-center text-sm text-muted-foreground">
					ยังไม่มีข้อมูลถังแก๊ส — กรุณากรอกแบบฟอร์มด้านบนเพื่อเพิ่มรายการใหม่
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row class="bg-muted/40 hover:bg-muted/40">
								<Table.Head class="font-semibold">ชื่อประเภทเตา/แก๊ส</Table.Head>
								<Table.Head class="text-right font-semibold">ความจุต่อถัง (kg)</Table.Head>
								<Table.Head class="text-right font-semibold">Burn Rate (kg/ชม.)</Table.Head>
								<Table.Head class="text-right font-semibold">ตัวคูณเวลา</Table.Head>
								<Table.Head class="text-center font-semibold">สถานะ</Table.Head>
								<Table.Head class="min-w-[140px] font-semibold">ระดับคงเหลือ (%)</Table.Head>
								<Table.Head class="text-right font-semibold">คงเหลือ</Table.Head>
								<Table.Head class="text-center font-semibold">การจัดการ</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each gasTypes.data as g (g._id)}
								{@const remaining = remainingOf(g)}
								{@const status = gasCylinderStatus(remaining, g.capacity_kg)}
								{@const capNum = parseFloat(g.capacity_kg) || 1}
								{@const remNum = parseFloat(remaining) || 0}
								{@const pct = Math.max(0, Math.min(100, Math.round((remNum / capNum) * 100)))}
								<Table.Row>
									<Table.Cell>
										<div class="flex items-center gap-2">
											<div
												class="rounded-md bg-orange-50 p-1.5 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
											>
												<Flame class="h-3.5 w-3.5 shrink-0" />
											</div>
											<span class="font-medium text-foreground">{g.name}</span>
										</div>
									</Table.Cell>
									<Table.Cell class="text-right font-mono">{g.capacity_kg} kg</Table.Cell>
									<Table.Cell class="text-right font-mono text-blue-600 dark:text-blue-400">
										{g.burn_rate_kg_per_hour} kg/ชม.
									</Table.Cell>
									<Table.Cell class="text-right font-mono text-muted-foreground">
										x{g.time_multiplier}
									</Table.Cell>
									<Table.Cell class="text-center">
										<Badge variant="outline" class={GAS_STATUS_CLASS[status]}>
											{GAS_STATUS_LABELS[status]}
										</Badge>
									</Table.Cell>
									<Table.Cell class="min-w-[140px]">
										<div class="flex items-center gap-2">
											<div class="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
												<div
													class="h-full rounded-full transition-all duration-300 {pct > 50
														? 'bg-emerald-500'
														: pct > 20
															? 'bg-amber-500'
															: 'bg-red-500'}"
													style="width: {pct}%"
												></div>
											</div>
											<span
												class="w-9 shrink-0 text-right font-mono text-xs font-semibold {pct > 50
													? 'text-emerald-600 dark:text-emerald-400'
													: pct > 20
														? 'text-amber-600 dark:text-amber-400'
														: 'text-red-600 dark:text-red-400'}"
											>
												{pct}%
											</span>
										</div>
									</Table.Cell>
									<Table.Cell class="text-right font-mono font-semibold text-foreground">
										{remaining} kg
									</Table.Cell>
									<Table.Cell class="text-center">
										<div class="flex items-center justify-center gap-1">
											<Button
												type="button"
												variant="ghost"
												size="icon"
												class="h-8 w-8 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40"
												onclick={() => startRefill(g)}
												disabled={status === 'unused'}
												title="เติมแก๊ส"
												aria-label="เติมแก๊ส"
											>
												<Fuel class="h-4 w-4" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												class="h-8 w-8 text-muted-foreground hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/40"
												onclick={() => startWriteOff(g)}
												disabled={status !== 'in_use'}
												title="ตัดเศษเหลือทิ้ง — ใช้เมื่อถังเหลือน้อยเกินจะเบิกอีก"
												aria-label="ตัดเศษเหลือทิ้ง"
											>
												<Eraser class="h-4 w-4" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												class="h-8 w-8 text-muted-foreground hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/40"
												onclick={() => startEdit(g)}
												title="แก้ไข"
												aria-label="แก้ไข"
											>
												<Pencil class="h-4 w-4" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												class="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
												onclick={() => handleDelete(g)}
												disabled={deleteType.isPending}
												title="ลบ"
												aria-label="ลบ"
											>
												<Trash2 class="h-4 w-4" />
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Create Gas Cylinder Dialog Modal -->
	<Dialog.Root bind:open={createOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<div class="flex items-center gap-2">
					<div
						class="rounded-lg bg-orange-100 p-1.5 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400"
					>
						<Flame class="h-4 w-4" />
					</div>
					<Dialog.Title>เพิ่มรายการเตา/ถังแก๊สใหม่</Dialog.Title>
				</div>
				<Dialog.Description class="text-xs">
					ระบุประเภทเตา ขนาดความจุน้ำหนักแก๊สต่อถัง
					และอัตราสิ้นเปลืองสำหรับการคำนวณและตัดสต็อกอัตโนมัติ
				</Dialog.Description>
			</Dialog.Header>

			<form method="POST" use:enhance class="space-y-4">
				<Form.Field {form} name="name" class="space-y-1.5">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-xs font-medium">ชื่อประเภทเตา/แก๊ส</Form.Label>
							<Input
								{...props}
								placeholder="เช่น เตาแก๊สแรงดันสูง + ถัง 15kg"
								bind:value={$formData.name}
								required
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<Form.Field {form} name="capacity_kg" class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-xs font-medium">ความจุ (kg)</Form.Label>
								<Input
									{...props}
									type="text"
									inputmode="decimal"
									bind:value={$formData.capacity_kg}
									required
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="burn_rate_kg_per_hour" class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-xs font-medium">Burn (kg/ชม.)</Form.Label>
								<Input
									{...props}
									type="text"
									inputmode="decimal"
									bind:value={$formData.burn_rate_kg_per_hour}
									required
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name="time_multiplier" class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-xs font-medium">ตัวคูณเวลา</Form.Label>
								<Input
									{...props}
									type="text"
									inputmode="decimal"
									bind:value={$formData.time_multiplier}
									required
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<Dialog.Footer class="gap-2 pt-2">
					<Button type="button" variant="outline" onclick={() => (createOpen = false)}>
						ยกเลิก
					</Button>
					<Button
						type="submit"
						disabled={$submitting || createType.isPending || !$formData.name}
						class="gap-1.5"
					>
						<Plus class="h-4 w-4" />
						{$submitting || createType.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าแก๊ส'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Edit Dialog -->
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
						<Input id="gas-edit-mult" type="text" inputmode="decimal" bind:value={editMultiplier} />
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

	<!-- Refill Dialog -->
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

	<!-- Write-off Alert Dialog -->
	<AlertDialog.Root bind:open={writeOffOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>ตัดเศษเหลือทิ้ง?</AlertDialog.Title>
				<AlertDialog.Description>
					{#if writeOffDoc}
						ถัง "{writeOffDoc.name}" เหลือ {remainingOf(writeOffDoc)} kg — เศษจำนวนนี้เบิกต่อไม่ได้ (เบิกแก๊สบางส่วนไม่ได้)
						การตัดเศษจะปรับยอดเหลือเป็น 0 กก. ทันที (บันทึกเป็นรายการ ปรับยอดใน ledger, กู้คืนไม่ได้ —
						เติมแก๊สใหม่ได้ตามปกติ)
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
