<script lang="ts">
	import { getDistributionStore } from '../application/item-distribution-store.svelte';
	import type { TargetGroup, DistributionMode, CatalogItem } from '../domain/item-distribution';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import Package from '@lucide/svelte/icons/package';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';
	import { useShelters } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';

	const store = getDistributionStore();
	const shelters = useShelters();

	// Component form state using Svelte 5 runes
	let selectedHubCode = $state(shelterStore.selectedShelterCode ?? '');
	let targetGroup = $state<TargetGroup>('evacuee');
	let distributionMode = $state<DistributionMode>('permanent');
	let reason = $state('');

	$effect(() => {
		if (!selectedHubCode && shelterStore.selectedShelterCode) {
			selectedHubCode = shelterStore.selectedShelterCode;
		}
	});

	// Item list in requisition form
	let formItems = $state<Array<{ catalogItemId: string; quantity: number }>>([
		{ catalogItemId: 'item-001', quantity: 1 }
	]);

	function addItemRow() {
		const availableItem =
			store.catalogItems.find(
				(c: CatalogItem) => !formItems.some((fi) => fi.catalogItemId === c.id)
			) || store.catalogItems[0];

		formItems = [...formItems, { catalogItemId: availableItem.id, quantity: 1 }];
	}

	function removeItemRow(index: number) {
		if (formItems.length === 1) {
			toast.error('ต้องมีอย่างน้อย 1 รายการ');
			return;
		}
		formItems = formItems.filter((_, i) => i !== index);
	}

	function getItemUnit(catalogItemId: string): string {
		const item = store.catalogItems.find((c: CatalogItem) => c.id === catalogItemId);
		return item ? item.unit : 'ชิ้น';
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		const hub = shelters.data?.find((s) => s.code === selectedHubCode);
		if (!hub) {
			toast.error('กรุณาเลือกศูนย์พักพิงปลายทาง');
			return;
		}

		if (formItems.length === 0) {
			toast.error('กรุณาระบุรายการสินค้าที่ต้องการเบิก');
			return;
		}

		for (const item of formItems) {
			if (!item.catalogItemId || item.quantity <= 0) {
				toast.error('กรุณากรอกข้อมูลรายการสินค้าและจำนวนให้ถูกต้อง');
				return;
			}
		}

		const newTicket = store.createRequisition({
			hubId: hub.code,
			hubName: hub.name,
			targetGroup,
			distributionMode,
			items: formItems,
			reason
		});

		toast.success(`สร้างคำร้องขอเบิก ${newTicket.ticket_code} สำเร็จแล้ว!`);
	}
</script>

<Dialog.Root
	open={store.createModalOpen}
	onOpenChange={(open) => {
		if (!open) store.closeCreateModal();
	}}
>
	<Dialog.Content class="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
		<Dialog.Header class="border-b p-6 pr-10 pb-4">
			<div class="flex items-start gap-3">
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400"
				>
					<Package class="size-6" />
				</div>
				<div class="min-w-0">
					<Dialog.Title class="text-xl font-bold">
						สร้างคำร้องขอเบิกพัสดุเพื่อแจกจ่ายช่วยเหลือ
					</Dialog.Title>
					<Dialog.Description class="mt-0.5 text-xs">
						ส่งรายการความต้องการเพื่อรอคลังต้นทางพิจารณาอนุมัติจัดล็อตสินค้า
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<!-- Modal Body (Scrollable) -->
		<form onsubmit={handleSubmit} class="flex-1 space-y-6 overflow-y-auto p-6">
			<!-- 1. ศูนย์พักพิงปลายทางที่ต้องการเบิกสินค้า -->
			<div class="space-y-2">
				<Label
					class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
				>
					ศูนย์พักพิงปลายทางที่ต้องการเบิกสินค้า <span class="text-rose-500">*</span>
				</Label>
				<Select.Root type="single" bind:value={selectedHubCode}>
					<Select.Trigger class="w-full">
						<span class="min-w-0 truncate">
							{shelters.data?.find((s) => s.code === selectedHubCode)?.name ?? 'เลือกศูนย์พักพิง'}
						</span>
					</Select.Trigger>
					<Select.Content>
						{#each shelters.data ?? [] as hub (hub.code)}
							<Select.Item value={hub.code} label={hub.name}>{hub.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- 2. กลุ่มเป้าหมายผู้รับพัสดุ (TARGET GROUP) -->
			<div class="space-y-2">
				<span
					class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
				>
					กลุ่มเป้าหมายผู้รับพัสดุ (TARGET GROUP) <span class="text-rose-500">*</span>
				</span>
				<div class="grid grid-cols-2 gap-3">
					<Button
						type="button"
						variant={targetGroup === 'evacuee' ? 'default' : 'secondary'}
						class="h-auto gap-2.5 py-3 text-sm font-bold {targetGroup === 'evacuee'
							? 'dark:bg-emerald-600'
							: ''}"
						onclick={() => (targetGroup = 'evacuee')}
					>
						<Users class="size-4" />
						<span>ผู้ประสบภัย / ผู้พักพิง</span>
					</Button>
					<Button
						type="button"
						variant={targetGroup === 'volunteer' ? 'default' : 'secondary'}
						class="h-auto gap-2.5 py-3 text-sm font-bold {targetGroup === 'volunteer'
							? 'dark:bg-emerald-600'
							: ''}"
						onclick={() => (targetGroup = 'volunteer')}
					>
						<UserCheck class="size-4" />
						<span>อาสาสมัคร / เจ้าหน้าที่</span>
					</Button>
				</div>
			</div>

			<!-- 3. รายการสินค้าที่ต้องการเบิก -->
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<span
						class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
					>
						รายการสินค้าที่ต้องการเบิก <span class="text-rose-500">*</span>
					</span>
					<Button
						type="button"
						variant="link"
						size="sm"
						onclick={addItemRow}
						class="h-auto gap-1.5 p-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
					>
						<Plus class="size-3.5" />
						<span>เพิ่มรายการ</span>
					</Button>
				</div>

				<div
					class="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-900/30"
				>
					{#each formItems as row, idx (idx)}
						<div
							class="flex items-center gap-3 rounded-lg border border-slate-200/80 bg-white p-3 shadow-xs dark:border-slate-700 dark:bg-slate-800"
						>
							<!-- Item Select -->
							<div class="min-w-[200px] flex-1">
								<Select.Root type="single" bind:value={row.catalogItemId}>
									<Select.Trigger class="w-full">
										{@const item = store.catalogItems.find(
											(c: CatalogItem) => c.id === row.catalogItemId
										)}
										<span class="min-w-0 truncate">
											{item ? `${item.name} (${item.category})` : 'เลือกสินค้า'}
										</span>
									</Select.Trigger>
									<Select.Content>
										{#each store.catalogItems as item (item.id)}
											<Select.Item value={item.id} label="{item.name} ({item.category})">
												{item.name} ({item.category})
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>

							<!-- Qty Input -->
							<div class="flex w-36 items-center gap-1.5">
								<Label for="qty-input-{idx}" class="sr-only">จำนวน</Label>
								<Input
									id="qty-input-{idx}"
									type="number"
									min="1"
									bind:value={row.quantity}
									placeholder="ระบุจำนวน..."
									class="font-semibold"
								/>
								<span class="w-8 shrink-0 text-xs font-semibold text-slate-500">
									{getItemUnit(row.catalogItemId)}
								</span>
							</div>

							<!-- Remove Button -->
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onclick={() => removeItemRow(idx)}
								title="ลบรายการ"
								class="text-slate-400 hover:text-rose-600"
							>
								<Trash2 class="size-4" />
							</Button>
						</div>
					{/each}
				</div>
			</div>

			<!-- 4. รูปแบบการแจกจ่ายรอบนี้ (DISTRIBUTION MODE) -->
			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<span
						class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
					>
						รูปแบบการแจกจ่ายรอบนี้ (DISTRIBUTION MODE) <span class="text-rose-500">*</span>
					</span>
					<span
						class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
					>
						Auto-default ตามประเภทพัสดุ
					</span>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<!-- Mode A: Permanent -->
					<button
						type="button"
						onclick={() => (distributionMode = 'permanent')}
						class="flex flex-col justify-between rounded-xl border-2 p-4 text-left transition-all {distributionMode ===
						'permanent'
							? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500 dark:bg-emerald-950/20'
							: 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/40'}"
					>
						<div
							class="mb-1 flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-300"
						>
							<CheckCircle2 class="size-4 text-emerald-600 dark:text-emerald-400" />
							<span>แจกจ่ายขาด (ไม่ต้องคืน)</span>
						</div>
						<p class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
							* สำหรับสิ่งของใช้แล้วหมดไป เช่น น้ำดื่ม สบู่ ยาสีฟัน ข้าวสาร (ไม่ต้องบันทึกการรับคืน)
						</p>
					</button>

					<!-- Mode B: Borrow-Return -->
					<button
						type="button"
						onclick={() => (distributionMode = 'borrow_return')}
						class="flex flex-col justify-between rounded-xl border-2 p-4 text-left transition-all {distributionMode ===
						'borrow_return'
							? 'border-emerald-500 bg-emerald-50/50 ring-1 ring-emerald-500 dark:bg-emerald-950/20'
							: 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/40'}"
					>
						<div
							class="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200"
						>
							<RotateCcw class="size-4 text-blue-600 dark:text-blue-400" />
							<span>ยืม-คืนชั่วคราว (ส่งคืนเมื่อจบกะ/ภารกิจ)</span>
						</div>
						<p class="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
							* สำหรับอุปกรณ์หรือพัสดุถาวร เช่น เสื้อกั๊ก วิทยุสื่อสาร เต็นท์ ไฟฉาย (ต้องส่งคืนคลัง)
						</p>
					</button>
				</div>
			</div>

			<!-- 5. ระบุเหตุผล / หมายเหตุคำร้อง -->
			<div class="space-y-2">
				<Label
					for="reason-input"
					class="block text-xs font-semibold tracking-wider text-slate-700 uppercase dark:text-slate-300"
				>
					ระบุเหตุผล / หมายเหตุคำขอร้อง (ระบุรอบแจกจ่าย)
				</Label>
				<Textarea
					id="reason-input"
					bind:value={reason}
					rows={3}
					placeholder="เช่น ต้องการเบิกไปแจกจ่ายช่วยเหลือรอบบ่าย สำหรับผู้สูงอายุในอาคาร B..."
				/>
			</div>

			<Dialog.Footer class="border-t pt-4">
				<Button type="button" variant="ghost" onclick={() => store.closeCreateModal()}>
					ยกเลิก (Cancel)
				</Button>
				<Button type="submit" class="gap-2 bg-emerald-600 font-bold hover:bg-emerald-500">
					<span>ส่งคำร้องขอเบิก (Submit Request)</span>
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
