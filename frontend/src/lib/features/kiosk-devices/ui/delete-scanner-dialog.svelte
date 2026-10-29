<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { ScannerDevice } from '../domain/scanner.schema';

	let {
		open = $bindable(false),
		device,
		pending = false,
		onconfirm
	}: {
		open?: boolean;
		/** The device the dialog was opened for — its name and id are shown (FR-SBO-30). */
		device: ScannerDevice | null;
		pending?: boolean;
		onconfirm: (device: ScannerDevice) => void;
	} = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-destructive">
				<TriangleAlert class="size-5 shrink-0" />
				<AlertDialog.Title>ยืนยันการลบเครื่อง</AlertDialog.Title>
			</div>
			{#if device}
				<AlertDialog.Description class="space-y-2 pt-2 text-sm">
					<span class="block">
						ลบเครื่อง <span class="font-semibold text-foreground">{device.name}</span>
						(<code class="text-xs">{device.device_id}</code>) ของศูนย์ {device.shelter_code}
					</span>
					<span class="block font-medium text-destructive">
						ลบแล้วย้อนกลับไม่ได้ ตู้นี้จะใช้งานไม่ได้ทันที
						ถ้าต้องการใช้ต่อต้องลงทะเบียนเครื่องใหม่และตั้ง Scanner Key ใหม่ที่ตู้
					</span>
				</AlertDialog.Description>
			{/if}
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={pending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				disabled={pending || !device}
				onclick={() => device && onconfirm(device)}
			>
				{pending ? 'กำลังลบ...' : 'ลบเครื่อง'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
