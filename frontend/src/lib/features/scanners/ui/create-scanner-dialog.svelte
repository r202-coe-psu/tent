<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { scannerDeviceInputSchema, type CreatedScannerDevice } from '../domain/scanner.schema';
	import { useCreateScannerDevice } from '../application/queries';

	let {
		open = $bindable(false),
		oncreated
	}: {
		open?: boolean;
		oncreated: (created: CreatedScannerDevice) => void;
	} = $props();

	const createMutation = useCreateScannerDevice();

	let deviceId = $state('');
	let name = $state('');
	let shelterCode = $state('SH001');
	let stationName = $state('จุดคัดกรองหลัก');

	function resetForm() {
		deviceId = '';
		name = '';
		shelterCode = 'SH001';
		stationName = 'จุดคัดกรองหลัก';
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	function handleCreate() {
		const parsed = scannerDeviceInputSchema.safeParse({
			device_id: deviceId,
			name,
			shelter_code: shelterCode.toUpperCase(),
			station_name: stationName,
			status: 'active'
		});

		if (!parsed.success) {
			const first = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
			toast.error(first);
			return;
		}

		createMutation.mutate(
			{ input: parsed.data },
			{
				onSuccess: (created) => {
					toast.success('ลงทะเบียนเครื่องสแกนสำเร็จ');
					open = false;
					resetForm();
					oncreated(created as CreatedScannerDevice);
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลงทะเบียนเครื่อง');
				}
			}
		);
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title class="text-xl font-bold">ลงทะเบียนเครื่องสแกนบัตร (Scanner)</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				เพิ่มอุปกรณ์ Smart Card Reader ใหม่เข้าสู่ระบบส่วนกลาง และสร้าง API Secret สำหรับเชื่อมต่อ
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="device-id" class="text-sm font-semibold">
					Device ID <span class="text-destructive">*</span>
				</Label>
				<Input
					id="device-id"
					bind:value={deviceId}
					placeholder="เช่น SCAN-01, SCAN-SH001-A"
					autocomplete="off"
				/>
				<p class="text-xs text-muted-foreground">รหัสอ้างอิงอุปกรณ์ (ภาษาอังกฤษ ตัวเลข _ หรือ -)</p>
			</div>

			<div class="grid gap-2">
				<Label for="device-name" class="text-sm font-semibold">
					ชื่ออุปกรณ์ / คำอธิบาย <span class="text-destructive">*</span>
				</Label>
				<Input
					id="device-name"
					bind:value={name}
					placeholder="เช่น เครื่องสแกนจุดลงทะเบียนประตู 1"
				/>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="shelter-code" class="text-sm font-semibold">
						รหัสศูนย์พักพิง <span class="text-destructive">*</span>
					</Label>
					<Input id="shelter-code" bind:value={shelterCode} placeholder="SH001" />
				</div>

				<div class="grid gap-2">
					<Label for="station-name" class="text-sm font-semibold">จุดบริการ / เคาน์เตอร์</Label>
					<Input id="station-name" bind:value={stationName} placeholder="เช่น เคาน์เตอร์ 1" />
				</div>
			</div>
		</div>

		<Dialog.Footer class="gap-2 sm:gap-0">
			<Button variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button onclick={handleCreate} disabled={createMutation.isPending}>
				{createMutation.isPending ? 'กำลังบันทึก...' : 'สร้างและรับ Secret'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
