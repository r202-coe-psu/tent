<script lang="ts">
	/**
	 * CR-089 FR-09 — where the driver and plate get entered, at the moment of dispatch.
	 * Confirming a dispatch is this dialog's only job: it must not host any other transition
	 * (cancel/dispute/resume live in the row itself). The create-request form is untouched (FR-10).
	 */
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Truck from '@lucide/svelte/icons/truck';
	import { toast } from 'svelte-sonner';
	import { dispatchInfoSchema, type DispatchInfoInput } from '../domain/operations';

	interface Props {
		open: boolean;
		/** Route label of the transfer being dispatched, e.g. `SH001 → SH002`. */
		route: string;
		isPending?: boolean;
		/** Called only after client-side validation passes (FR-01). */
		onConfirm: (info: DispatchInfoInput) => void;
	}

	let { open = $bindable(false), route, isPending = false, onConfirm }: Props = $props();

	let driverName = $state('');
	let vehiclePlate = $state('');

	function handleOpenChange(next: boolean) {
		open = next;
		// Cancelling must leave no trace behind — no mutation, no retained input (FR-09).
		if (!next) {
			driverName = '';
			vehiclePlate = '';
		}
	}

	function handleConfirm() {
		// Same schema the server parses, so the dialog cannot disagree with the domain rule.
		const parsed = dispatchInfoSchema.safeParse({
			driver_name: driverName,
			vehicle_plate: vehiclePlate
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'กรุณากรอกผู้ขับขี่และทะเบียนรถ');
			return;
		}
		onConfirm(parsed.data);
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-[460px]">
		<Dialog.Header>
			<Dialog.Title class="text-lg font-bold">ยืนยันการส่งมอบ</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				ระบุผู้ขับขี่และทะเบียนรถสำหรับเส้นทาง <span class="font-mono font-semibold">{route}</span>
				— เมื่อยืนยันแล้วระบบจะตัดสต็อกจากศูนย์ต้นทางทันที
			</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-4 py-2">
			<div class="grid gap-2">
				<Label for="dispatch-driver-name" class="text-sm font-semibold">
					ชื่อผู้ขับขี่ <span class="text-destructive">*</span>
				</Label>
				<Input
					id="dispatch-driver-name"
					bind:value={driverName}
					placeholder="เช่น สมชาย ใจดี"
					autocomplete="off"
					disabled={isPending}
				/>
			</div>

			<div class="grid gap-2">
				<Label for="dispatch-vehicle-plate" class="text-sm font-semibold">
					ทะเบียนรถ <span class="text-destructive">*</span>
				</Label>
				<Input
					id="dispatch-vehicle-plate"
					bind:value={vehiclePlate}
					placeholder="เช่น กท 1234"
					autocomplete="off"
					disabled={isPending}
				/>
			</div>
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => handleOpenChange(false)} disabled={isPending}>
				ยกเลิก
			</Button>
			<Button onclick={handleConfirm} disabled={isPending}>
				<Truck class="mr-1 h-4 w-4" />
				{isPending ? 'กำลังอนุมัติ...' : 'ยืนยันส่งมอบ'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
