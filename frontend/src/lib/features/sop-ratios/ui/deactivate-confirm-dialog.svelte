<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button/index.js';
	import Loader from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';

	interface Props {
		open: boolean;
		shelterCode: string;
		onConfirm: () => Promise<void>;
		isPending?: boolean;
	}

	let { open = $bindable(false), shelterCode, onConfirm, isPending = false }: Props = $props();

	async function handleConfirm() {
		try {
			await onConfirm();
			open = false;
		} catch (err) {
			console.error('Failed to confirm deactivation:', err);
			toast.error('เกิดข้อผิดพลาด — กรุณาลองอีกครั้ง');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl p-6">
		<Dialog.Header class="pb-2">
			<Dialog.Title class="text-base font-black text-slate-900">
				ยืนยันการยกเลิกค่าปรับแต่ง
			</Dialog.Title>
			<Dialog.Description class="mt-2 text-sm font-medium text-slate-500">
				คุณต้องการยกเลิกค่าปรับแต่งและกลับไปใช้ค่ามาตรฐาน EOC สำหรับศูนย์ {shelterCode} ใช่หรือไม่?
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="mt-6 flex justify-end gap-3">
			<Button
				variant="outline"
				class="rounded-xl font-bold"
				onclick={() => (open = false)}
				disabled={isPending}
			>
				ยกเลิก
			</Button>
			<Button
				variant="destructive"
				class="inline-flex items-center gap-2 rounded-xl font-bold"
				onclick={handleConfirm}
				disabled={isPending}
			>
				{#if isPending}
					<Loader class="size-4 animate-spin" />
					<span>กำลังยกเลิก...</span>
				{:else}
					<span>ยืนยัน</span>
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
