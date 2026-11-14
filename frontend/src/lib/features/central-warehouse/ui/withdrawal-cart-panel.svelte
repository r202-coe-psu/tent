<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import Send from '@lucide/svelte/icons/send';
	import ShoppingCart from '@lucide/svelte/icons/shopping-cart';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { useCreateWithdrawal } from '../application/central-warehouse-queries';
	import type { WithdrawalCartState } from '../application/withdrawal-cart.svelte';
	import { exceedsAvailable } from '../domain/central-warehouse.cart';
	import type { WithdrawalCreateInput } from '../domain/central-warehouse.payload';
	import { formatQty, m6ErrorMessage } from './central-warehouse.ui';

	let {
		cart,
		enabled,
		onSubmitted
	}: {
		cart: WithdrawalCartState;
		/** False while the M6 gate is closed: the cart can be edited but not sent. */
		enabled: boolean;
		onSubmitted: () => void;
	} = $props();

	const queryClient = useQueryClient();
	const createMutation = useCreateWithdrawal(queryClient);

	let confirmOpen = $state(false);
	let showErrors = $state(false);

	const blockers = $derived(cart.blockers);
	const overLines = $derived(cart.cart.lines.filter((l) => exceedsAvailable(l)));

	function onQtyChange(itemCode: string, event: Event & { currentTarget: HTMLInputElement }) {
		cart.setQty(itemCode, Number(event.currentTarget.value));
		// Re-show the normalised value (0, 2.5 and blanks are corrected, not just stored).
		event.currentTarget.value = String(
			cart.cart.lines.find((l) => l.item_code === itemCode)?.qty ?? ''
		);
	}

	function review() {
		showErrors = true;
		if (blockers.length > 0) return;
		confirmOpen = true;
	}

	async function send() {
		const c = cart.cart;
		if (!c.warehouse_code) return;
		const input: WithdrawalCreateInput = {
			source_warehouse_code: c.warehouse_code,
			source_warehouse_name: c.warehouse_name,
			reason: cart.reason.trim(),
			contact_role: cart.contactRole.trim(),
			contact_phone: cart.contactPhone.trim(),
			lines: c.lines.map((l) => ({
				item_code: l.item_code,
				name: l.name,
				unit: l.unit,
				type_code: l.type_code,
				qty: l.qty
			}))
		};
		try {
			const created = await createMutation.mutateAsync(input);
			confirmOpen = false;
			showErrors = false;
			cart.reset();
			toast.success(`ส่งคำขอเบิกแล้ว (${created.request_code}) รอ M6 พิจารณา`);
			onSubmitted();
		} catch (e) {
			confirmOpen = false;
			toast.error(m6ErrorMessage(e));
		}
	}
</script>

<section
	aria-label="ตะกร้าขอเบิก"
	class="space-y-5 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
>
	{#if cart.count === 0}
		<div class="flex flex-col items-center gap-2 py-8 text-center text-slate-500">
			<ShoppingCart class="h-8 w-8" aria-hidden="true" />
			<p class="text-sm">ตะกร้ายังว่าง เลือกของจากแท็บ "คลังกลาง" เพื่อเพิ่มลงตะกร้า</p>
		</div>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div>
				<h3 class="text-lg font-bold text-slate-900">ขอเบิกจาก {cart.cart.warehouse_name}</h3>
				<p class="text-sm text-slate-500">ใบเบิก 1 ใบต่อ 1 คลังต้นทาง · {cart.count} รายการ</p>
			</div>
			<Button variant="outline" class="h-11 gap-2" onclick={() => cart.clear()}>
				<Trash2 class="h-4 w-4" aria-hidden="true" />
				ล้างตะกร้า
			</Button>
		</div>

		<div class="overflow-x-auto rounded-lg border border-slate-200">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>สิ่งของ</Table.Head>
						<Table.Head class="w-40">จำนวน</Table.Head>
						<Table.Head>หน่วย</Table.Head>
						<Table.Head class="text-right">คงเหลือ</Table.Head>
						<Table.Head><span class="sr-only">เอาออก</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each cart.cart.lines as line (line.item_code)}
						<Table.Row>
							<Table.Cell class="font-medium text-slate-900">
								{line.name}
								<span class="block text-xs font-normal text-slate-500">{line.item_code}</span>
								{#if exceedsAvailable(line)}
									<span class="mt-1 flex items-start gap-1.5 text-xs font-semibold text-amber-900">
										<TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
										ขอเกินจำนวนคงเหลือ ส่งได้ M6 จะพิจารณาเอง
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<Label for="m6-qty-{line.item_code}" class="sr-only">
									จำนวน {line.name}
								</Label>
								<Input
									id="m6-qty-{line.item_code}"
									type="number"
									inputmode="numeric"
									min="1"
									step="1"
									value={line.qty}
									onchange={(e) => onQtyChange(line.item_code, e)}
									class="h-11 w-32 tabular-nums sm:h-10"
								/>
							</Table.Cell>
							<Table.Cell class="text-slate-700">{line.unit}</Table.Cell>
							<Table.Cell class="text-right text-slate-700 tabular-nums">
								{formatQty(line.available)}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Button
									variant="ghost"
									size="icon"
									class="h-11 w-11 text-red-700 hover:bg-red-50"
									onclick={() => cart.remove(line.item_code)}
								>
									<Trash2 class="h-4 w-4" aria-hidden="true" />
									<span class="sr-only">เอา {line.name} ออกจากตะกร้า</span>
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="m6-contact-role" class="text-sm font-semibold text-slate-700">
					ตำแหน่งผู้ติดต่อ <span class="text-red-600">*</span>
				</Label>
				<Input
					id="m6-contact-role"
					bind:value={cart.contactRole}
					placeholder="เช่น หัวหน้าฝ่ายพัสดุ"
					maxlength={60}
					class="h-11 sm:h-10"
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="m6-contact-phone" class="text-sm font-semibold text-slate-700">
					เบอร์โทรผู้ติดต่อ <span class="text-red-600">*</span>
				</Label>
				<Input
					id="m6-contact-phone"
					type="tel"
					inputmode="tel"
					bind:value={cart.contactPhone}
					placeholder="0812345678"
					maxlength={20}
					class="h-11 tabular-nums sm:h-10"
				/>
			</div>
			<div class="space-y-1.5 sm:col-span-2">
				<Label for="m6-reason" class="text-sm font-semibold text-slate-700">
					เหตุผลการเบิก <span class="text-red-600">*</span>
				</Label>
				<Textarea
					id="m6-reason"
					rows={3}
					bind:value={cart.reason}
					maxlength={2000}
					placeholder="เช่น ของในศูนย์ใกล้หมด มีผู้เข้าพักเพิ่ม"
				/>
				<p class="text-xs text-slate-500">ผู้ขอและเบอร์โทรจะถูกส่งให้ M6 ใช้ติดต่อกลับ</p>
			</div>
		</div>

		{#if overLines.length > 0}
			<p class="flex items-start gap-2 text-sm font-semibold text-amber-900">
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				มี {overLines.length} รายการที่ขอเกินจำนวนคงเหลือ ยังส่งได้ แต่ M6 อาจอนุมัติไม่ครบ
			</p>
		{/if}

		{#if showErrors && blockers.length > 0}
			<ul class="list-disc space-y-0.5 pl-5 text-sm text-red-900" role="alert">
				{#each blockers as b (b)}<li>{b}</li>{/each}
			</ul>
		{/if}

		<div class="flex justify-end">
			<Button class="h-11 gap-2" disabled={!enabled || createMutation.isPending} onclick={review}>
				<Send class="h-4 w-4" aria-hidden="true" />
				ส่งคำขอเบิก
			</Button>
		</div>
	{/if}
</section>

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>ยืนยันส่งคำขอเบิก</Dialog.Title>
			<Dialog.Description>
				ส่งคำขอเบิก {cart.count} รายการจาก "{cart.cart.warehouse_name}" ไปให้ M6 พิจารณา
				ระหว่างรอพิจารณายกเลิกได้ที่แท็บ "คำขอของศูนย์"
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="gap-2">
			<Button variant="outline" class="h-11" onclick={() => (confirmOpen = false)}>กลับไปแก้</Button
			>
			<Button class="h-11 gap-2" disabled={createMutation.isPending} onclick={send}>
				<Send class="h-4 w-4" aria-hidden="true" />
				{createMutation.isPending ? 'กำลังส่ง…' : 'ยืนยันส่ง'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
