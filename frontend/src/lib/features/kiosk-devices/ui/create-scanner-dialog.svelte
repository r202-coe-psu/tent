<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import { scannerDeviceInputSchema, type CreatedScannerDevice } from '../domain/scanner.schema';
	import { useCreateScannerDevice } from '../application/queries';
	import KioskScreenPicker from '$lib/features/shared/ui/kiosk-screen-picker.svelte';
	import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
	import ShelterScopeSelect from '$lib/components/shelter-scope-select.svelte';

	let {
		open = $bindable(false),
		fixedShelterCode,
		oncreated
	}: {
		open?: boolean;
		/** `null` = system admin picks any shelter; a code = shelter manager, locked to it. */
		fixedShelterCode: string | null;
		oncreated: (created: CreatedScannerDevice) => void;
	} = $props();

	const createMutation = useCreateScannerDevice();
	let deviceId = $state('');
	let name = $state('');
	let pickedShelterCode = $state<string | undefined>(undefined);
	let stationName = $state('จุดคัดกรองหลัก');
	let screenType = $state<KioskScreenType>('compact');

	const shelterCode = $derived(fixedShelterCode ?? pickedShelterCode);

	function resetForm() {
		deviceId = '';
		name = '';
		pickedShelterCode = undefined;
		stationName = 'จุดคัดกรองหลัก';
		screenType = 'compact';
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	function handleCreate() {
		if (!shelterCode) {
			toast.error('กรุณาเลือกศูนย์พักพิง');
			return;
		}
		const parsed = scannerDeviceInputSchema.safeParse({
			device_id: deviceId,
			name,
			shelter_code: shelterCode.toUpperCase(),
			station_name: stationName,
			status: 'active',
			screen_type: screenType
		});

		if (!parsed.success) {
			const first = parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';
			toast.error(first);
			return;
		}

		createMutation.mutate(parsed.data, {
			onSuccess: (created) => {
				toast.success('ลงทะเบียนเครื่องสแกนสำเร็จ');
				open = false;
				resetForm();
				oncreated({
					...created.device,
					plaintext_secret: created.plaintext_secret,
					plaintext_staff_pin: created.plaintext_staff_pin
				});
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการลงทะเบียนเครื่อง');
			}
		});
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-[500px]">
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

			<div class="grid gap-2">
				<span class="text-sm font-semibold">
					ศูนย์พักพิง <span class="text-destructive">*</span>
				</span>
				<ShelterScopeSelect
					allowedCodes={fixedShelterCode === null ? null : [fixedShelterCode]}
					bind:value={pickedShelterCode}
					ariaLabel="ศูนย์พักพิงประจำเครื่องสแกน"
				/>
				<p class="text-xs text-muted-foreground">
					{fixedShelterCode === null
						? 'เลือกศูนย์พักพิงประจำเครื่องสแกน'
						: 'เครื่องจะถูกลงทะเบียนในศูนย์พักพิงที่เลือกอยู่'}
				</p>
			</div>

			<div class="grid gap-2">
				<Label for="station-name" class="text-sm font-semibold">จุดบริการ / เคาน์เตอร์</Label>
				<Input
					id="station-name"
					bind:value={stationName}
					placeholder="เช่น จุดคัดกรองหลัก, ประตู 1"
				/>
			</div>

			<div class="grid gap-2">
				<span id="screen-type-label" class="text-sm font-semibold">ขนาดหน้าจอ</span>
				<KioskScreenPicker
					id="create-screen-type"
					aria-labelledby="screen-type-label"
					bind:value={screenType}
				/>
				<p class="text-xs text-muted-foreground">
					ตู้จะได้รับเฉพาะแบนเนอร์ที่ออกแบบสำหรับขนาดหน้าจอนี้
				</p>
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
