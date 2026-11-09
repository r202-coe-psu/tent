<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ShelterScopeSelect from '$lib/components/shelter-scope-select.svelte';
	import { PrintApiError } from '../data/printers.api';
	import {
		printerCreateInputSchema,
		type PrinterSecretResponse
	} from '../domain/print-device.schema';
	import {
		printerCreateIssueMessage,
		SHELTER_CLOSED_MESSAGE
	} from '../domain/printer-admin.messages';
	import { useCreatePrinterDevice } from '../application/queries';

	let {
		open = $bindable(false),
		fixedShelterCode,
		oncreated
	}: {
		open?: boolean;
		/** `null` = system admin picks any shelter; a code = locked to that shelter. */
		fixedShelterCode: string | null;
		/** The one-time secret leaves through here; the page must not keep it past the reveal dialog. */
		oncreated: (created: PrinterSecretResponse) => void;
	} = $props();

	const createMutation = useCreatePrinterDevice();

	let deviceId = $state('');
	let name = $state('');
	let station = $state('');
	let pickedShelterCode = $state<string | undefined>(undefined);

	const shelterCode = $derived(fixedShelterCode ?? pickedShelterCode);

	function resetForm() {
		deviceId = '';
		name = '';
		station = '';
		pickedShelterCode = undefined;
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	async function handleCreate() {
		if (!shelterCode) {
			toast.error('กรุณาเลือกศูนย์พักพิง');
			return;
		}
		const parsed = printerCreateInputSchema.safeParse({
			device_id: deviceId.trim(),
			name,
			shelter_code: shelterCode.toUpperCase(),
			station: station.trim() || null
		});
		if (!parsed.success) {
			const [issue] = parsed.error.issues;
			toast.error(issue ? printerCreateIssueMessage(issue) : 'ข้อมูลไม่ถูกต้อง');
			return;
		}
		try {
			const created = await createMutation.mutateAsync(parsed.data);
			toast.success('ลงทะเบียนเครื่องพิมพ์สำเร็จ');
			handleOpenChange(false);
			oncreated(created);
			// The secret now lives only in the reveal dialog; drop the mutation's own copy.
			createMutation.reset();
		} catch (err) {
			toast.error(
				err instanceof PrintApiError && err.code === 'SHELTER_CLOSED'
					? SHELTER_CLOSED_MESSAGE
					: err instanceof PrintApiError && err.status === 409
						? 'Device ID นี้ถูกใช้แล้ว'
						: err instanceof Error
							? err.message
							: 'เกิดข้อผิดพลาดในการลงทะเบียนเครื่องพิมพ์'
			);
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-[500px]">
		<Dialog.Header>
			<Dialog.Title class="text-xl font-bold">ลงทะเบียนเครื่องพิมพ์</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				เพิ่มเครื่องพิมพ์ฉลากใหม่และสร้าง Device Secret สำหรับเชื่อมต่อ
			</Dialog.Description>
		</Dialog.Header>

		<form
			onsubmit={(event) => {
				event.preventDefault();
				void handleCreate();
			}}
		>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="printer-device-id" class="text-sm font-semibold">
						Device ID <span class="text-destructive">*</span>
					</Label>
					<Input
						id="printer-device-id"
						bind:value={deviceId}
						placeholder="เช่น printer-sh001-reg1"
						autocomplete="off"
					/>
					<p class="text-xs text-muted-foreground">ตัวพิมพ์เล็ก ตัวเลข และ - ยาว 3–63 ตัวอักษร</p>
				</div>

				<div class="grid gap-2">
					<Label for="printer-name" class="text-sm font-semibold">
						ชื่อเครื่อง <span class="text-destructive">*</span>
					</Label>
					<Input
						id="printer-name"
						bind:value={name}
						placeholder="เช่น โต๊ะลงทะเบียน 1"
						maxlength={80}
					/>
				</div>

				{#if fixedShelterCode === null}
					<div class="grid gap-2">
						<span class="text-sm font-semibold">
							ศูนย์พักพิง <span class="text-destructive">*</span>
						</span>
						<ShelterScopeSelect
							allowedCodes={null}
							bind:value={pickedShelterCode}
							ariaLabel="ศูนย์พักพิงประจำเครื่องพิมพ์"
						/>
					</div>
				{/if}

				<div class="grid gap-2">
					<Label for="printer-station" class="text-sm font-semibold">จุดบริการ</Label>
					<Input id="printer-station" bind:value={station} placeholder="เช่น ลงทะเบียน" />
				</div>
			</div>

			<Dialog.Footer class="gap-2 sm:gap-0">
				<Button type="button" variant="outline" onclick={() => handleOpenChange(false)}>
					ยกเลิก
				</Button>
				<Button type="submit" disabled={createMutation.isPending}>
					{createMutation.isPending ? 'กำลังบันทึก...' : 'สร้างและรับ Secret'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
