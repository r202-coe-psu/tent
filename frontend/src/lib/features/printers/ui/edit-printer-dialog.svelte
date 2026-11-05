<script lang="ts">
	/**
	 * "จัดการเครื่องพิมพ์" — every per-printer action in one dialog so the table only shows state:
	 * name / station / active (one PATCH of the changed fields), rotate secret (hands the one-time
	 * secret to the page's reveal dialog), test print, delete (with confirm).
	 */
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Printer from '@lucide/svelte/icons/printer';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { PrintApiError } from '../data/printers.api';
	import type {
		PrinterAdminSummary,
		PrinterPatch,
		PrinterSecretResponse
	} from '../domain/print-device.schema';
	import {
		useDeletePrinterDevice,
		useRotatePrinterSecret,
		useTestPrintPrinter,
		useUpdatePrinterDevice
	} from '../application/queries';

	let {
		open = $bindable(false),
		printer,
		onrotated
	}: {
		open?: boolean;
		/** Mounted per printer (keyed by the list), so the form starts from this printer's values. */
		printer: PrinterAdminSummary;
		/** A new secret was issued: the page shows it once in the reveal dialog. */
		onrotated?: (result: PrinterSecretResponse) => void;
	} = $props();

	const updateMutation = useUpdatePrinterDevice();
	const rotateMutation = useRotatePrinterSecret();
	const testPrintMutation = useTestPrintPrinter();
	const deleteMutation = useDeletePrinterDevice();

	// svelte-ignore state_referenced_locally
	let name = $state(printer.name);
	// svelte-ignore state_referenced_locally
	let station = $state(printer.station ?? '');
	// svelte-ignore state_referenced_locally
	let active = $state(printer.status === 'active');
	let confirmDeleteOpen = $state(false);
	let confirmRotateOpen = $state(false);

	/** Only the changed fields; `null` when nothing changed (or the name is blank). */
	const patch = $derived.by((): PrinterPatch | null => {
		const next: PrinterPatch = {};
		if (name.trim() && name.trim() !== printer.name) next.name = name.trim();
		if (station.trim() !== (printer.station ?? '')) next.station = station.trim() || null;
		const status = active ? 'active' : 'inactive';
		if (status !== printer.status) next.status = status;
		return Object.keys(next).length > 0 ? next : null;
	});
	const busy = $derived(
		updateMutation.isPending ||
			rotateMutation.isPending ||
			testPrintMutation.isPending ||
			deleteMutation.isPending
	);

	const errorText = (err: unknown) => (err instanceof Error ? err.message : 'ดำเนินการไม่สำเร็จ');

	async function save() {
		if (!patch) return;
		try {
			await updateMutation.mutateAsync({ deviceId: printer.device_id, patch });
			toast.success(`บันทึกการตั้งค่าเครื่อง ${patch.name ?? printer.name} แล้ว`);
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถบันทึกการตั้งค่าเครื่องได้');
		}
	}

	async function rotate() {
		try {
			const result = await rotateMutation.mutateAsync(printer.device_id);
			toast.success('ออก Device Secret ใหม่แล้ว');
			confirmRotateOpen = false;
			open = false;
			onrotated?.(result);
			// The secret now lives only in the reveal dialog; drop the mutation's own copy.
			rotateMutation.reset();
		} catch (err) {
			toast.error(errorText(err));
		}
	}

	async function testPrint() {
		try {
			await testPrintMutation.mutateAsync(printer.device_id);
			toast.success(`ส่งงานพิมพ์ทดสอบไปที่ ${printer.name} แล้ว`);
		} catch (err) {
			toast.error(
				err instanceof PrintApiError && err.code === 'PRINTER_OFFLINE'
					? `เครื่อง ${printer.name} ออฟไลน์ พิมพ์ทดสอบไม่ได้`
					: errorText(err)
			);
		}
	}

	async function remove() {
		try {
			await deleteMutation.mutateAsync(printer.device_id);
			toast.success('ลบเครื่องพิมพ์เรียบร้อยแล้ว');
			confirmDeleteOpen = false;
			open = false;
		} catch (err) {
			toast.error(errorText(err));
		}
	}

	const sectionTitle = 'text-xs font-bold tracking-wider text-slate-500 uppercase';
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
					<Printer class="h-5 w-5" />
				</div>
				<div class="min-w-0 space-y-1 text-left">
					<Dialog.Title class="text-lg font-bold text-slate-900">จัดการเครื่องพิมพ์</Dialog.Title>
					<Dialog.Description class="text-sm text-slate-500">
						<span class="font-semibold text-slate-700 tabular-nums">{printer.device_id}</span>
						· {printer.shelter_code}
					</Dialog.Description>
				</div>
			</div>
		</Dialog.Header>

		<form
			id="edit-printer-form"
			class="space-y-5"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<section class="space-y-3">
				<h3 class={sectionTitle}>ข้อมูลเครื่อง</h3>
				<div class="grid gap-2">
					<Label for="edit-printer-name" class="text-sm font-semibold text-slate-700">
						ชื่อเครื่อง <span class="text-destructive">*</span>
					</Label>
					<Input id="edit-printer-name" class="h-11" maxlength={80} bind:value={name} />
				</div>
				<div class="grid gap-2">
					<Label for="edit-printer-station" class="text-sm font-semibold text-slate-700">
						จุดบริการ
					</Label>
					<Input id="edit-printer-station" class="h-11" bind:value={station} />
				</div>
				<div
					class="flex items-center justify-between gap-4 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4"
				>
					<div class="space-y-0.5">
						<Label for="edit-printer-active" class="text-sm font-semibold text-slate-700">
							เปิดใช้งานเครื่อง
						</Label>
						<p class="text-xs text-slate-500">
							{active ? 'Active — รับงานพิมพ์ได้' : 'Inactive — ไม่รับงานพิมพ์จนกว่าจะเปิดอีกครั้ง'}
						</p>
					</div>
					<Switch id="edit-printer-active" bind:checked={active} />
				</div>
			</section>
		</form>

		<section class="space-y-3">
			<h3 class={sectionTitle}>การเชื่อมต่อและทดสอบ</h3>
			<div class="divide-y divide-slate-200/80 rounded-xl border border-slate-200/80">
				<div class="flex flex-wrap items-center justify-between gap-3 p-4">
					<div class="space-y-0.5">
						<p class="text-sm font-semibold text-slate-700">ออก Secret ใหม่</p>
						<p class="text-xs text-slate-500">
							เครื่องเดิมที่ใช้ Secret เก่าจะเชื่อมต่อไม่ได้ทันที
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						class="min-h-11 gap-1.5"
						disabled={busy}
						onclick={() => (confirmRotateOpen = true)}
					>
						<KeyRound class="h-4 w-4" />
						ออก Secret ใหม่
					</Button>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-3 p-4">
					<div class="space-y-0.5">
						<p class="text-sm font-semibold text-slate-700">พิมพ์ทดสอบ</p>
						<p class="text-xs text-slate-500">ส่งฉลากทดสอบ (ไม่มีข้อมูลบุคคล) ไปที่เครื่องนี้</p>
					</div>
					<Button
						type="button"
						variant="outline"
						class="min-h-11 gap-1.5"
						disabled={busy}
						onclick={testPrint}
					>
						<Printer class="h-4 w-4" />
						พิมพ์ทดสอบ
					</Button>
				</div>
			</div>
		</section>

		<section
			class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-white p-4"
		>
			<div class="space-y-0.5">
				<p class="text-sm font-semibold text-red-900">ลบเครื่องนี้</p>
				<p class="text-xs text-slate-500">งานพิมพ์ที่ค้างอยู่จะถูกยกเลิก และย้อนกลับไม่ได้</p>
			</div>
			<Button
				type="button"
				variant="outline"
				class="min-h-11 gap-1.5 border-red-200 text-destructive hover:bg-red-50 hover:text-destructive"
				disabled={busy}
				onclick={() => (confirmDeleteOpen = true)}
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
				form="edit-printer-form"
				class="btn-primary-brand min-h-11 gap-2"
				disabled={busy || !patch}
			>
				{#if updateMutation.isPending}
					<Loader2 class="h-4 w-4 animate-spin" />
					กำลังบันทึก...
				{:else}
					บันทึก
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmRotateOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการออก Secret ใหม่</AlertDialog.Title>
			<AlertDialog.Description class="space-y-2 pt-2 text-sm">
				<span class="block">ออก Device Secret ใหม่ให้เครื่อง {printer.name}</span>
				<span class="block font-medium text-destructive"
					>Secret เก่าจะใช้ไม่ได้ทันที เครื่อง Pi จะออฟไลน์จนกว่าจะนำ Secret ใหม่ไปติดตั้งในไฟล์
					.env และรีสตาร์ทโปรแกรม printer</span
				>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={rotateMutation.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				disabled={rotateMutation.isPending}
				onclick={rotate}
			>
				{rotateMutation.isPending ? 'กำลังออก Secret...' : 'ออก Secret ใหม่'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={confirmDeleteOpen}>
	<AlertDialog.Content class="max-w-md">
		<AlertDialog.Header>
			<AlertDialog.Title>ยืนยันการลบเครื่องพิมพ์</AlertDialog.Title>
			<AlertDialog.Description class="space-y-2 pt-2 text-sm">
				<span class="block">ลบเครื่อง {printer.name} ({printer.device_id}) ออกจากระบบ</span>
				<span class="block font-medium text-destructive"
					>ลบแล้วย้อนกลับไม่ได้ เครื่อง Pi จะเชื่อมต่อไม่ได้อีก ถ้าต้องการใช้ต่อต้องลงทะเบียนใหม่</span
				>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleteMutation.isPending}>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				disabled={deleteMutation.isPending}
				onclick={remove}
			>
				{deleteMutation.isPending ? 'กำลังลบ...' : 'ลบเครื่อง'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
