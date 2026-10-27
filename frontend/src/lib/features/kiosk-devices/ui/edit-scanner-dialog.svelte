<script lang="ts">
	/**
	 * "จัดการเครื่อง" — every per-device action of the kiosk list in one dialog, so the table only
	 * shows state. Name / service point / active / screen size are one form saved
	 * as a single PATCH of the changed fields; Scanner Key, staff PIN and delete hand off to their own
	 * dialogs.
	 */
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { resolve } from '$app/paths';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import KioskScreenPicker from '$lib/features/shared/ui/kiosk-screen-picker.svelte';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Eye from '@lucide/svelte/icons/eye';
	import Key from '@lucide/svelte/icons/key';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { ScannerDevice } from '../domain/scanner.schema';
	import {
		scannerEditFormSchema,
		scannerEditFormValues,
		scannerEditPatch
	} from '../domain/scanner-edit-form';
	import { useUpdateScannerDevice } from '../application/queries';
	import ScannerPinBadge from './scanner-pin-badge.svelte';

	let {
		open = $bindable(false),
		device,
		groupName = null,
		onviewsecret,
		onviewpin,
		onsetpin,
		ondelete
	}: {
		open?: boolean;
		/** Mounted per device (keyed by the list), so the form starts from this device's values. */
		device: ScannerDevice;
		/** Name of the banner group the device is in; `null` = no group. Assigned from the group side. */
		groupName?: string | null;
		onviewsecret?: (device: ScannerDevice) => void;
		onviewpin?: (device: ScannerDevice) => void;
		onsetpin?: (device: ScannerDevice) => void;
		ondelete?: (device: ScannerDevice) => void;
	} = $props();

	const updateMutation = useUpdateScannerDevice();

	/** Closed in `onUpdated`: superforms writes the submitted data back after `onUpdate` returns. */
	let savedThisSubmit = false;

	// svelte-ignore state_referenced_locally
	const form = superForm(
		defaults(scannerEditFormValues(device), zod4Client(scannerEditFormSchema)),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4Client(scannerEditFormSchema),
			resetForm: false,
			// Nothing to apply to a page: SPA forms update their own stores (no router round trip).
			applyAction: false,
			warnings: { duplicateId: false },
			onUpdate: async ({ form: validated }) => {
				savedThisSubmit = false;
				if (!validated.valid) return;
				const patch = scannerEditPatch(device, validated.data);
				if (!patch) {
					savedThisSubmit = true;
					return;
				}
				try {
					await updateMutation.mutateAsync({ deviceId: device.device_id, patch });
					toast.success(`บันทึกการตั้งค่าเครื่อง ${validated.data.name.trim()} แล้ว`);
					savedThisSubmit = true;
				} catch (err) {
					toast.error(err instanceof Error ? err.message : 'ไม่สามารถบันทึกการตั้งค่าเครื่องได้');
				}
			},
			onUpdated: () => {
				if (!savedThisSubmit) return;
				savedThisSubmit = false;
				open = false;
			}
		}
	);

	const { form: formData, enhance, submitting } = form;

	const changed = $derived(scannerEditPatch(device, $formData) !== null);
	const busy = $derived($submitting || updateMutation.isPending);

	/** Hand off to another dialog: close this one first so two modals never stack. */
	function handOff(action: ((device: ScannerDevice) => void) | undefined) {
		open = false;
		action?.(device);
	}

	const sectionTitle = 'text-xs font-bold tracking-wider text-slate-500 uppercase';
	const switchRow =
		'flex items-center justify-between gap-4 space-y-0 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4';
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="max-h-[90dvh] gap-5 overflow-y-auto rounded-2xl shadow-md sm:max-w-[560px]"
	>
		<Dialog.Header>
			<div class="flex items-start gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
				>
					<Cpu class="h-5 w-5" />
				</div>
				<div class="min-w-0 space-y-1 text-left">
					<Dialog.Title class="text-lg font-bold text-slate-900">จัดการเครื่องสแกน</Dialog.Title>
					<Dialog.Description class="text-sm text-slate-500">
						<span class="font-semibold text-slate-700 tabular-nums">{device.device_id}</span>
						· ศูนย์ {device.shelter_code}
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<form id="edit-scanner-form" method="post" use:enhance novalidate class="space-y-5">
			<section class="space-y-3">
				<h3 class={sectionTitle}>ข้อมูลเครื่อง</h3>
				<Form.Field {form} name="name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-700">
								ชื่ออุปกรณ์ / คำอธิบาย <span class="text-destructive">*</span>
							</Form.Label>
							<Input {...props} class="h-11" bind:value={$formData.name} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="station_name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-700">
								จุดบริการ / เคาน์เตอร์ <span class="text-destructive">*</span>
							</Form.Label>
							<Input {...props} class="h-11" bind:value={$formData.station_name} />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</section>

			<section class="space-y-3">
				<h3 class={sectionTitle}>การทำงาน</h3>
				<Form.Field {form} name="status" class={switchRow}>
					<Form.Control>
						{#snippet children({ props })}
							<div class="space-y-0.5">
								<Form.Label class="text-sm font-semibold text-slate-700"
									>เปิดใช้งานเครื่อง</Form.Label
								>
								<Form.Description class="text-xs text-slate-500">
									{$formData.status === 'active'
										? 'Active — ตู้ยืนยันตัวตนและเช็กอินได้'
										: 'Inactive — ตู้ใช้งานไม่ได้จนกว่าจะเปิดอีกครั้ง'}
								</Form.Description>
							</div>
							<Switch
								{...props}
								bind:checked={
									() => $formData.status === 'active',
									(next) => ($formData.status = next ? 'active' : 'inactive')
								}
							/>
						{/snippet}
					</Form.Control>
				</Form.Field>
				<div class={switchRow}>
					<div class="space-y-0.5">
						<p class="text-sm font-semibold text-slate-700">กลุ่มแบนเนอร์</p>
						<p class="text-xs text-slate-500">
							{groupName ?? 'ไม่มีกลุ่ม — เครื่องนี้ไม่แสดงแบนเนอร์'}
						</p>
					</div>
					<a
						href={resolve('/back-office/kiosks/banners')}
						class="inline-flex min-h-11 items-center text-sm font-semibold text-[#0A2647] underline underline-offset-2"
					>
						จัดการกลุ่มแบนเนอร์
					</a>
				</div>
				<Form.Field {form} name="screen_type" class="space-y-2">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="text-sm font-semibold text-slate-700">ขนาดหน้าจอ</Form.Label>
							<KioskScreenPicker {...props} bind:value={$formData.screen_type} />
						{/snippet}
					</Form.Control>
					<Form.Description class="text-xs text-slate-500">
						เลือกตามตู้จริง — ตู้จะได้รับเฉพาะแบนเนอร์ที่ออกแบบสำหรับขนาดนี้
					</Form.Description>
					<Form.FieldErrors />
				</Form.Field>
			</section>
		</form>

		<section class="space-y-3">
			<h3 class={sectionTitle}>การเชื่อมต่อและความปลอดภัย</h3>
			<div class="divide-y divide-slate-200/80 rounded-xl border border-slate-200/80">
				<div class="flex flex-wrap items-center justify-between gap-3 p-4">
					<div class="space-y-0.5">
						<p class="text-sm font-semibold text-slate-700">Scanner Key</p>
						<p class="text-xs text-slate-500">ข้อมูลสำหรับตั้งค่าเชื่อมต่อที่ตู้</p>
					</div>
					<Button
						type="button"
						variant="outline"
						class="min-h-11 gap-1.5"
						onclick={() => handOff(onviewsecret)}
					>
						<Key class="h-4 w-4" />
						ดูข้อมูลการติดตั้ง
					</Button>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-3 p-4">
					<div class="space-y-1.5">
						<p class="text-sm font-semibold text-slate-700">PIN เจ้าหน้าที่</p>
						<ScannerPinBadge {device} />
					</div>
					<div class="flex flex-wrap gap-2">
						{#if device.staff_pin_set}
							<Button
								type="button"
								variant="outline"
								class="min-h-11 gap-1.5"
								onclick={() => handOff(onviewpin)}
							>
								<Eye class="h-4 w-4" />
								ดู PIN
							</Button>
						{/if}
						<Button
							type="button"
							variant="outline"
							class="min-h-11 gap-1.5"
							onclick={() => handOff(onsetpin)}
						>
							<KeyRound class="h-4 w-4" />
							ตั้ง PIN
						</Button>
					</div>
				</div>
			</div>
		</section>

		<section
			class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-white p-4"
		>
			<div class="space-y-0.5">
				<p class="text-sm font-semibold text-red-900">ลบเครื่องนี้</p>
				<p class="text-xs text-slate-500">ตู้จะใช้งานไม่ได้ทันที และย้อนกลับไม่ได้</p>
			</div>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 gap-1.5 border-red-200 text-destructive hover:bg-red-50 hover:text-destructive"
				onclick={() => handOff(ondelete)}
			>
				<Trash2 class="h-4 w-4" />
				ลบเครื่อง
			</Button>
		</section>

		<Dialog.Footer class="gap-2">
			<Button type="button" variant="outline" class="min-h-11" onclick={() => (open = false)}>
				ยกเลิก
			</Button>
			<Button
				type="submit"
				form="edit-scanner-form"
				class="btn-primary-brand min-h-11 gap-2"
				disabled={busy || !changed}
			>
				{#if busy}
					<Loader2 class="h-4 w-4 animate-spin" />
					กำลังบันทึก...
				{:else}
					บันทึก
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
