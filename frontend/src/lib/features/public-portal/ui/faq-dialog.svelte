<script lang="ts">
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { z } from 'zod';
	import type { publicConfigBodySchema, FaqItem } from '../domain/config';
	
	type ConfigBody = z.infer<typeof publicConfigBodySchema>;

	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { toast } from 'svelte-sonner';

	let {
		open = $bindable(false),
		editingItem = $bindable(),
		editingIndex,
		formData,
		activeType,
		submit
	}: {
		open: boolean;
		editingItem: FaqItem;
		editingIndex: number | null;
		formData: SuperFormData<ConfigBody>;
		activeType: string;
		submit?: () => void;
	} = $props();

	function saveModal() {
		if (!editingItem.question.trim() || !editingItem.answer.trim()) {
			toast.error('กรุณาระบุคำถามและคำตอบ');
			return;
		}

		if (!$formData.faqs[activeType]) {
			$formData.faqs[activeType] = [];
		}

		if (editingIndex !== null) {
			$formData.faqs[activeType][editingIndex] = { ...editingItem };
		} else {
			$formData.faqs[activeType] = [...$formData.faqs[activeType], { ...editingItem }];
		}
		open = false;
		
		// Wait a tick for the store to update, then submit
		setTimeout(() => submit?.(), 0);
	}
</script>

<Dialog.Root bind:open={open}>
	<Dialog.Content class="sm:max-w-[500px]">
		<Dialog.Header>
			<Dialog.Title>{editingIndex !== null ? 'แก้ไขคำถาม' : 'เพิ่มคำถามใหม่'}</Dialog.Title>
			<Dialog.Description>
				ระบุคำถามและคำตอบที่ต้องการให้แสดงผล
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<Label for="question">คำถาม</Label>
				<Input id="question" bind:value={editingItem.question} placeholder="เช่น วิธีการลงทะเบียน?" />
			</div>
			
			<div class="space-y-2">
				<Label for="answer">คำตอบ</Label>
				<Textarea id="answer" bind:value={editingItem.answer} placeholder="คำตอบ..." rows={4} />
			</div>

			<div class="flex items-center justify-between rounded-lg border p-3">
				<div>
					<Label>การเผยแพร่</Label>
					<p class="text-sm text-muted-foreground">แสดงคำถามนี้ในหน้าเว็บ</p>
				</div>
				<Switch bind:checked={editingItem.is_published} />
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => open = false}>ยกเลิก</Button>
			<Button onclick={saveModal}>ยืนยัน</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
