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
	import { authStore } from '$lib/stores/auth.svelte';

	interface Props {
		open: boolean;
		/** Route label of the transfer being dispatched, e.g. `SH001 → SH002`. */
		route: string;
		isPending?: boolean;
		/** Called only after client-side validation passes (FR-01). */
		onConfirm: (info: DispatchInfoInput) => void;
	}

	let { open = $bindable(false), route, isPending = false, onConfirm }: Props = $props();

	// Session expired (`needsReauth`): every save button is off until the user signs in again.
	const offline = $derived(authStore.needsReauth);

	let driverName = $state('');
	let vehiclePlate = $state('');
	let submitted = $state(false);

	// Inline messages from the same schema the server parses; shown once a confirm was tried.
	const fieldErrors = $derived.by(() => {
		if (!submitted) return { driver: '', plate: '' };
		const r = dispatchInfoSchema.safeParse({
			driver_name: driverName,
			vehicle_plate: vehiclePlate
		});
		const msg = (key: string) =>
			r.success ? '' : (r.error.issues.find((i) => i.path[0] === key)?.message ?? '');
		return { driver: msg('driver_name'), plate: msg('vehicle_plate') };
	});

	function handleOpenChange(next: boolean) {
		open = next;
		// Cancelling must leave no trace behind — no mutation, no retained input (FR-09).
		if (!next) {
			driverName = '';
			vehiclePlate = '';
			submitted = false;
		}
	}

	function handleConfirm() {
		// Same schema the server parses, so the dialog cannot disagree with the domain rule.
		const parsed = dispatchInfoSchema.safeParse({
			driver_name: driverName,
			vehicle_plate: vehiclePlate
		});
		submitted = true;
		if (!parsed.success) {
			const first = parsed.error.issues[0]?.path[0];
			document
				.getElementById(
					first === 'vehicle_plate' ? 'dispatch-vehicle-plate' : 'dispatch-driver-name'
				)
				?.focus();
			toast.error('กรุณากรอกผู้ขับขี่และทะเบียนรถให้ครบ');
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
					class="rounded-lg shadow-2xs"
					id="dispatch-driver-name"
					aria-invalid={fieldErrors.driver ? true : undefined}
					aria-describedby={fieldErrors.driver ? 'dispatch-driver-name-error' : undefined}
					bind:value={driverName}
					placeholder="เช่น สมชาย ใจดี"
					autocomplete="off"
					disabled={isPending}
				/>
				{#if fieldErrors.driver}
					<p id="dispatch-driver-name-error" class="text-xs font-medium text-destructive">
						{fieldErrors.driver}
					</p>
				{/if}
			</div>

			<div class="grid gap-2">
				<Label for="dispatch-vehicle-plate" class="text-sm font-semibold">
					ทะเบียนรถ <span class="text-destructive">*</span>
				</Label>
				<Input
					class="rounded-lg shadow-2xs"
					id="dispatch-vehicle-plate"
					aria-invalid={fieldErrors.plate ? true : undefined}
					aria-describedby={fieldErrors.plate ? 'dispatch-vehicle-plate-error' : undefined}
					bind:value={vehiclePlate}
					placeholder="เช่น กท 1234"
					autocomplete="off"
					disabled={isPending}
				/>
				{#if fieldErrors.plate}
					<p id="dispatch-vehicle-plate-error" class="text-xs font-medium text-destructive">
						{fieldErrors.plate}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="gap-2">
			<Button variant="outline" onclick={() => handleOpenChange(false)} disabled={isPending}>
				ยกเลิก
			</Button>
			<Button onclick={handleConfirm} disabled={isPending || offline}>
				<Truck class="mr-1 h-4 w-4" />
				{isPending ? 'กำลังอนุมัติ...' : 'ยืนยันส่งมอบ'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
