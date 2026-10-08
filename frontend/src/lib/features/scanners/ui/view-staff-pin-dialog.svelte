<script lang="ts">
	/**
	 * SA-only "ดู PIN": the PIN is fetched from the reveal endpoint only when SA clicks show/copy
	 * (never prefetched, never in the query cache), shown masked by default, and dropped from
	 * state as soon as the dialog closes or switches device. Toasts never contain the PIN.
	 */
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { ScannerDevice, StaffPinReveal } from '../domain/scanner.schema';
	import { useRevealScannerStaffPin } from '../application/queries';

	let {
		open = $bindable(false),
		device = null,
		onsetpin
	}: {
		open?: boolean;
		device?: ScannerDevice | null;
		/** Opens the "ตั้ง PIN" dialog for the same device (used by the change-default advice). */
		onsetpin?: (device: ScannerDevice) => void;
	} = $props();

	const revealMutation = useRevealScannerStaffPin();

	/** Tagged with the device it belongs to, so a stale PIN never shows for another device. */
	let revealed = $state.raw<{ deviceId: string; data: StaffPinReveal } | null>(null);
	let visible = $state(false);

	const current = $derived(
		revealed && device && revealed.deviceId === device.id ? revealed.data : null
	);
	const isDefault = $derived(
		current ? current.is_default : (device?.staff_pin_is_default ?? false)
	);
	const loading = $derived(revealMutation.isPending);

	function clear() {
		revealed = null;
		visible = false;
		revealMutation.reset();
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) clear();
	}

	function close() {
		handleOpenChange(false);
	}

	async function ensureRevealed(): Promise<StaffPinReveal | null> {
		if (!device) return null;
		if (current) return current;
		const deviceId = device.id;
		try {
			const data = await revealMutation.mutateAsync(deviceId);
			// Hold the PIN only in this component; drop the mutation's copy right away.
			revealMutation.reset();
			if (!open) return null;
			revealed = { deviceId, data };
			return data;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ไม่สามารถเปิดดู PIN ได้');
			return null;
		}
	}

	async function toggleVisible() {
		if (visible) {
			visible = false;
			return;
		}
		if (await ensureRevealed()) visible = true;
	}

	async function copyPin() {
		const data = await ensureRevealed();
		if (!data) return;
		try {
			await navigator.clipboard.writeText(data.pin);
			toast.success('คัดลอก PIN แล้ว');
		} catch {
			toast.error('ไม่สามารถคัดลอกได้');
		}
	}

	function formatUpdatedAt(value: string | null): string {
		if (!value) return '—';
		return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="max-h-[90dvh] gap-3 overflow-y-auto rounded-2xl shadow-md sm:max-w-[480px]"
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-slate-900">
				<KeyRound class="h-5 w-5 text-[#0A2647]" />
				<span>PIN เจ้าหน้าที่ของเครื่อง</span>
			</Dialog.Title>
			<Dialog.Description class="text-sm text-slate-500">
				ใช้ที่ตู้ kiosk เมื่อเจ้าหน้าที่ต้องข้ามการตรวจใบหน้า โปรดเก็บเป็นความลับ
			</Dialog.Description>
		</Dialog.Header>

		{#if device}
			<div class="min-w-0 space-y-4 py-2">
				<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
					<p class="font-semibold text-slate-900">{device.name}</p>
					<p class="text-xs break-all text-slate-500">
						{device.device_id} · {device.shelter_code} · {device.station_name}
					</p>
				</div>

				{#if !device.staff_pin_set}
					<div
						class="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-100 p-3.5 text-sm text-slate-700"
					>
						<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
						<p>เครื่องนี้ยังไม่ได้ตั้ง PIN เจ้าหน้าที่ จึงข้ามการตรวจใบหน้าที่ตู้ไม่ได้</p>
					</div>
				{:else}
					<div class="space-y-2">
						<p id="staff-pin-label" class="text-sm font-semibold text-slate-700">PIN 6 หลัก</p>
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
							<output
								aria-labelledby="staff-pin-label"
								aria-live="polite"
								class="flex min-h-14 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-3xl font-bold tracking-[0.3em] text-[#0A2647] tabular-nums"
							>
								{#if visible && current}
									{current.pin}
								{:else}
									<span aria-hidden="true">••••••</span>
									<span class="sr-only">PIN ถูกซ่อนอยู่</span>
								{/if}
							</output>
							<div class="flex gap-2">
								<Button
									variant="outline"
									class="min-h-11 flex-1 gap-1.5 sm:flex-none"
									onclick={toggleVisible}
									disabled={loading}
									aria-pressed={visible}
								>
									{#if visible}
										<EyeOff class="h-4 w-4" />
										<span>ซ่อน</span>
									{:else}
										<Eye class="h-4 w-4" />
										<span>{loading ? 'กำลังโหลด…' : 'แสดง'}</span>
									{/if}
									<span class="sr-only">PIN</span>
								</Button>
								<Button
									variant="outline"
									class="min-h-11 flex-1 gap-1.5 sm:flex-none"
									onclick={copyPin}
									disabled={loading}
								>
									<Copy class="h-4 w-4" />
									<span>คัดลอก</span>
									<span class="sr-only">PIN</span>
								</Button>
							</div>
						</div>
						{#if current}
							<p class="text-xs text-slate-500">
								ตั้งล่าสุด <span class="tabular-nums">{formatUpdatedAt(current.updated_at)}</span>
								{#if current.updated_by}
									โดย {current.updated_by}
								{/if}
							</p>
						{/if}
					</div>

					{#if isDefault}
						<div
							class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900"
						>
							<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
							<div class="space-y-2">
								<p>
									<span class="font-semibold">ยังเป็น PIN เริ่มต้นที่ระบบสร้างให้</span>
									แนะนำให้เปลี่ยนเป็น PIN ที่แจ้งเฉพาะเจ้าหน้าที่ประจำจุด
								</p>
								{#if onsetpin}
									<Button
										variant="outline"
										size="sm"
										class="min-h-11 bg-white"
										onclick={() => {
											const target = device;
											close();
											if (target) onsetpin(target);
										}}
									>
										เปลี่ยน PIN
									</Button>
								{/if}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button class="w-full sm:w-auto" onclick={close}>ปิดหน้าต่าง</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
