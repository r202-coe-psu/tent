<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { useUpdateDonationItems } from '../application/queries';
	import type { DonationItemEdit } from '../data/public-tracking';

	let {
		open = $bindable(false),
		token,
		items,
		onSaved
	}: {
		open?: boolean;
		token: string;
		items: Array<{
			item_id?: string | null;
			item_name?: string;
			qty: unknown;
			unit?: string | null;
		}>;
		onSaved?: () => void;
	} = $props();

	type Row = { item_id?: string; free_text: string; qty: string; unit: string };

	// A draft the donor edits, seeded once at mount. The caller renders this component
	// only while the dialog is open, so every open starts from the current booking and
	// an abandoned edit cannot linger into the next one — no $effect syncing props into
	// state, which would fight the user's own typing.
	// untrack because reading `items` once is the point: this is a draft, not a mirror.
	// Tracking it would overwrite whatever the donor has typed the moment a refetch lands.
	let rows = $state<Row[]>(
		untrack(() =>
			items.map((item) => ({
				item_id: item.item_id ?? undefined,
				free_text: item.item_name ?? '',
				qty: item.qty != null ? String(item.qty) : '',
				unit: item.unit ?? ''
			}))
		)
	);

	const mutation = useUpdateDonationItems();

	const canSave = $derived(
		rows.length > 0 &&
			rows.every((row) => row.free_text.trim() && Number(row.qty) > 0 && row.unit.trim())
	);

	function addRow() {
		rows = [...rows, { free_text: '', qty: '', unit: '' }];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	function save() {
		const payload: DonationItemEdit[] = rows.map((row) => ({
			...(row.item_id ? { item_id: row.item_id } : {}),
			free_text: row.free_text.trim(),
			qty: String(Number(row.qty)),
			unit: row.unit.trim()
		}));

		mutation.mutate(
			{ token, items: payload },
			{
				onSuccess: () => {
					toast.success('แก้ไขรายการบริจาคแล้ว');
					open = false;
					onSaved?.();
				},
				onError: (err) => toast.error(err instanceof Error ? err.message : 'แก้ไขรายการไม่สำเร็จ')
			}
		);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>แก้ไขรายการที่จะบริจาค</Dialog.Title>
			<Dialog.Description>
				ปรับจำนวน เพิ่ม หรือลบรายการได้ตามต้องการ — เจ้าหน้าที่จะตรวจนับอีกครั้งตอนรับของจริง
				ทุกการแก้ไขจะถูกบันทึกไว้
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			{#each rows as row, index (index)}
				<div class="flex items-end gap-2 rounded-2xl border border-border bg-card p-3">
					<div class="min-w-0 flex-1 space-y-1">
						<label class="text-[10px] font-bold text-muted-foreground uppercase" for="name-{index}">
							สิ่งของ
						</label>
						<Input
							id="name-{index}"
							bind:value={row.free_text}
							placeholder="เช่น ข้าวสาร"
							class="h-9 rounded-xl text-xs"
						/>
					</div>
					<div class="w-20 space-y-1">
						<label class="text-[10px] font-bold text-muted-foreground uppercase" for="qty-{index}">
							จำนวน
						</label>
						<Input
							id="qty-{index}"
							type="number"
							min="0"
							step="any"
							bind:value={row.qty}
							class="h-9 rounded-xl text-xs"
						/>
					</div>
					<div class="w-20 space-y-1">
						<label class="text-[10px] font-bold text-muted-foreground uppercase" for="unit-{index}">
							หน่วย
						</label>
						<Input
							id="unit-{index}"
							bind:value={row.unit}
							placeholder="กก."
							class="h-9 rounded-xl text-xs"
						/>
					</div>
					<Button
						variant="ghost"
						size="icon"
						class="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
						aria-label="ลบรายการ {row.free_text || index + 1}"
						disabled={rows.length === 1}
						onclick={() => removeRow(index)}
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
			{/each}

			<Button variant="outline" class="h-9 w-full rounded-xl text-xs font-bold" onclick={addRow}>
				<Plus class="h-4 w-4" />
				เพิ่มรายการ
			</Button>
		</div>

		<Dialog.Footer>
			<Button
				variant="outline"
				class="rounded-xl text-xs font-bold"
				disabled={mutation.isPending}
				onclick={() => (open = false)}
			>
				ยกเลิก
			</Button>
			<Button
				class="rounded-xl text-xs font-bold"
				disabled={!canSave || mutation.isPending}
				onclick={save}
			>
				{mutation.isPending ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
