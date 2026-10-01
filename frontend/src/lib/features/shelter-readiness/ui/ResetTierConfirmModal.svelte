<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	interface Props {
		open: boolean;
		targetTierLabel: string;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { open = $bindable(false), targetTierLabel, onConfirm, onCancel }: Props = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<div class="flex items-center gap-2 text-amber-600">
				<AlertTriangle class="size-5 shrink-0" />
				<AlertDialog.Title>ยืนยันการเปลี่ยนระดับศูนย์พักพิง</AlertDialog.Title>
			</div>
			<AlertDialog.Description class="pt-2 text-sm text-slate-600">
				คุณกำลังจะเปลี่ยนระดับเป็น <strong>"{targetTierLabel}"</strong>
				<br /><br />
				<span class="font-medium text-rose-600">
					⚠️ คำเตือน: การเปลี่ยนระดับจะรีเซ็ตคำตอบการตรวจทั้งหมดที่กรอกไว้
				</span>
				เนื่องจากชุดคำถามและเกณฑ์ความสำคัญของแต่ละระดับ (ชุมชน, อปท., เมือง) มีความแตกต่างกัน
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer class="pt-3">
			<AlertDialog.Cancel onclick={onCancel}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action class="bg-amber-600 text-white hover:bg-amber-700" onclick={onConfirm}>
				ยืนยันและรีเซ็ตคำตอบ
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
