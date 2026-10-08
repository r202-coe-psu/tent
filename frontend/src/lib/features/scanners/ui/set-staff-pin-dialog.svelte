<script lang="ts">
	/**
	 * SA-only "ตั้ง PIN": choose a 6-digit PIN (+ confirm) or regenerate a random one. The PIN is
	 * kept server-side in an admin-only database; a regenerated PIN is shown here once (masked by
	 * default) and dropped from state when the dialog closes. Toasts never contain the PIN.
	 */
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import Copy from '@lucide/svelte/icons/copy';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Shuffle from '@lucide/svelte/icons/shuffle';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import {
		setStaffPinFormSchema,
		STAFF_PIN_LENGTH,
		type ScannerDevice,
		type SetStaffPinFormValues
	} from '../domain/scanner.schema';
	import { useSetScannerStaffPin } from '../application/queries';

	let {
		open = $bindable(false),
		device = null
	}: {
		open?: boolean;
		device?: ScannerDevice | null;
	} = $props();

	const setMutation = useSetScannerStaffPin();

	function emptyValues(): SetStaffPinFormValues {
		return { pin: '', confirm: '' };
	}

	/** A regenerated PIN, held only while this dialog stays open for the same device. */
	let generated = $state.raw<{ deviceId: string; pin: string } | null>(null);
	let generatedVisible = $state(false);

	const generatedPin = $derived(
		generated && device && generated.deviceId === device.id ? generated.pin : null
	);

	/**
	 * Set in `onUpdate` once the PIN is saved; the dialog is closed (and the form cleared) in
	 * `onUpdated`, because superforms writes the submitted data back into the form after `onUpdate`
	 * returns — clearing earlier would leave this device's PIN in the fields for the next device.
	 */
	let savedThisSubmit = false;

	const form = superForm(defaults(emptyValues(), zod4Client(setStaffPinFormSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4Client(setStaffPinFormSchema),
		resetForm: false,
		warnings: { duplicateId: false },
		onUpdate: async ({ form: validated }) => {
			savedThisSubmit = false;
			if (!validated.valid || !device) return;
			const target = device;
			try {
				await setMutation.mutateAsync({ id: target.id, body: { pin: validated.data.pin } });
				setMutation.reset();
				toast.success(`ตั้ง PIN ของเครื่อง ${target.name} แล้ว`);
				savedThisSubmit = true;
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'ไม่สามารถตั้ง PIN ได้');
			}
		},
		onUpdated: () => {
			if (!savedThisSubmit) return;
			savedThisSubmit = false;
			close();
		}
	});

	const { form: formData, errors, enhance, submitting } = form;

	const busy = $derived($submitting || setMutation.isPending);

	function clear() {
		form.reset({ data: emptyValues() });
		generated = null;
		generatedVisible = false;
		setMutation.reset();
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) clear();
	}

	function close() {
		handleOpenChange(false);
	}

	/** Keep only digits, capped at 6 — the PIN never needs anything else. */
	function digitsOnly(value: string): string {
		return value.replace(/\D/g, '').slice(0, STAFF_PIN_LENGTH);
	}

	async function regenerate() {
		if (!device) return;
		const target = device;
		try {
			const result = await setMutation.mutateAsync({ id: target.id, body: { regenerate: true } });
			setMutation.reset();
			// The PIN has changed on the server even if the dialog was closed meanwhile — always say so.
			toast.success(`สุ่ม PIN ใหม่ให้เครื่อง ${target.name} แล้ว`);
			if (!open || !result.pin) return;
			generated = { deviceId: target.id, pin: result.pin };
			generatedVisible = false;
			$formData = emptyValues();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถสุ่ม PIN ใหม่ได้');
		}
	}

	async function copyGenerated() {
		if (!generatedPin) return;
		try {
			await navigator.clipboard.writeText(generatedPin);
			toast.success('คัดลอก PIN แล้ว');
		} catch {
			toast.error('ไม่สามารถคัดลอกได้');
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="max-h-[90dvh] gap-3 overflow-y-auto rounded-2xl shadow-md sm:max-w-[480px]"
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-slate-900">
				<KeyRound class="h-5 w-5 text-[#0A2647]" />
				<span>ตั้ง PIN เจ้าหน้าที่</span>
			</Dialog.Title>
			<Dialog.Description class="text-sm text-slate-500">
				PIN 6 หลักสำหรับข้ามการตรวจใบหน้าที่ตู้ kiosk ของเครื่องนี้ ตั้งใหม่แล้ว PIN
				เดิมใช้ไม่ได้ทันที
			</Dialog.Description>
		</Dialog.Header>

		{#if device}
			<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
				<p class="font-semibold text-slate-900">{device.name}</p>
				<p class="text-xs break-all text-slate-500">
					{device.device_id} · {device.shelter_code} · {device.station_name}
				</p>
			</div>

			{#if generatedPin}
				<div
					class="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-900"
				>
					<p class="flex items-center gap-2 text-sm font-semibold">
						<CircleCheck class="h-4 w-4 text-emerald-700" />
						<span id="generated-pin-label">PIN ใหม่ของเครื่องนี้</span>
					</p>
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
						<output
							aria-labelledby="generated-pin-label"
							class="flex min-h-14 flex-1 items-center justify-center rounded-xl border border-emerald-200 bg-white px-4 text-3xl font-bold tracking-[0.3em] text-[#0A2647] tabular-nums"
						>
							{#if generatedVisible}
								{generatedPin}
							{:else}
								<span aria-hidden="true">••••••</span>
								<span class="sr-only">PIN ถูกซ่อนอยู่</span>
							{/if}
						</output>
						<div class="flex gap-2">
							<Button
								variant="outline"
								class="min-h-11 flex-1 gap-1.5 bg-white sm:flex-none"
								onclick={() => (generatedVisible = !generatedVisible)}
								aria-pressed={generatedVisible}
							>
								{#if generatedVisible}
									<EyeOff class="h-4 w-4" />
									<span>ซ่อน</span>
								{:else}
									<Eye class="h-4 w-4" />
									<span>แสดง</span>
								{/if}
								<span class="sr-only">PIN</span>
							</Button>
							<Button
								variant="outline"
								class="min-h-11 flex-1 gap-1.5 bg-white sm:flex-none"
								onclick={copyGenerated}
							>
								<Copy class="h-4 w-4" />
								<span>คัดลอก</span>
								<span class="sr-only">PIN</span>
							</Button>
						</div>
					</div>
					<p class="text-xs">เปิดดู PIN ได้อีกจากรายการเครื่อง (ปุ่ม「ดู PIN」)</p>
				</div>
			{/if}

			<form method="POST" use:enhance class="space-y-4" novalidate>
				<Field.Group class="gap-4">
					<Field.Field data-invalid={$errors.pin ? true : undefined}>
						<Field.Label for="staff-pin">PIN ใหม่ (ตัวเลข 6 หลัก)</Field.Label>
						<Input
							id="staff-pin"
							name="pin"
							type="password"
							inputmode="numeric"
							autocomplete="off"
							maxlength={STAFF_PIN_LENGTH}
							class="h-11 text-lg tracking-[0.3em] tabular-nums"
							aria-invalid={$errors.pin ? true : undefined}
							bind:value={() => $formData.pin, (v) => ($formData.pin = digitsOnly(v))}
						/>
						{#if $errors.pin}
							<Field.Error>{$errors.pin[0]}</Field.Error>
						{:else}
							<Field.Description>ห้ามใช้เลขซ้ำทั้งหมด หรือเลขเรียงอย่าง 123456</Field.Description>
						{/if}
					</Field.Field>
					<Field.Field data-invalid={$errors.confirm ? true : undefined}>
						<Field.Label for="staff-pin-confirm">ยืนยัน PIN</Field.Label>
						<Input
							id="staff-pin-confirm"
							name="confirm"
							type="password"
							inputmode="numeric"
							autocomplete="off"
							maxlength={STAFF_PIN_LENGTH}
							class="h-11 text-lg tracking-[0.3em] tabular-nums"
							aria-invalid={$errors.confirm ? true : undefined}
							bind:value={() => $formData.confirm, (v) => ($formData.confirm = digitsOnly(v))}
						/>
						{#if $errors.confirm}
							<Field.Error>{$errors.confirm[0]}</Field.Error>
						{/if}
					</Field.Field>
				</Field.Group>

				<Dialog.Footer class="flex-col gap-2 sm:flex-row sm:justify-between">
					<Button
						type="button"
						variant="outline"
						class="min-h-11 gap-1.5"
						onclick={regenerate}
						disabled={busy}
					>
						<Shuffle class="h-4 w-4" />
						สุ่ม PIN ใหม่
					</Button>
					<div class="flex flex-col gap-2 sm:flex-row">
						<Button type="button" variant="outline" class="min-h-11" onclick={close}>
							{generatedPin ? 'ปิดหน้าต่าง' : 'ยกเลิก'}
						</Button>
						<Button type="submit" class="min-h-11" disabled={busy}>
							{busy ? 'กำลังบันทึก…' : 'บันทึก PIN'}
						</Button>
					</div>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
