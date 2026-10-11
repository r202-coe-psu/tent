<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Key from '@lucide/svelte/icons/key';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import type { CreatedScannerDevice, ScannerDevice } from '../domain/scanner.schema';

	let {
		open = $bindable(false),
		device = null,
		isNew = false,
		onclose
	}: {
		open?: boolean;
		device?: ScannerDevice | CreatedScannerDevice | null;
		isNew?: boolean;
		/** The dialog closed: the page should drop the plaintext secret and PIN it handed in. */
		onclose?: () => void;
	} = $props();

	let copied = $state(false);
	let copiedEnv = $state(false);
	let pinVisible = $state(false);
	const deploymentBaseUrl = $derived(
		typeof window === 'undefined' ? 'https://<deployment-host>' : window.location.origin
	);

	const secretValue = $derived.by(() => {
		if (!device) return '';
		const created = device as CreatedScannerDevice;
		return created.plaintext_secret || '';
	});

	/** Default staff PIN — present only right after create (the create response always carries it). */
	const staffPinValue = $derived.by(() => {
		if (!device || !isNew) return null;
		return (device as CreatedScannerDevice).plaintext_staff_pin ?? null;
	});

	async function copyStaffPin() {
		if (!staffPinValue) return;
		try {
			await navigator.clipboard.writeText(staffPinValue);
			toast.success('คัดลอก PIN เจ้าหน้าที่แล้ว');
		} catch {
			toast.error('ไม่สามารถคัดลอกได้');
		}
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (next) return;
		pinVisible = false;
		onclose?.();
	}

	const envSnippet = $derived.by(() => {
		if (!device || !secretValue) return '';
		return `TENT_BASE_URL=${deploymentBaseUrl}\nDEVICE_ID=${device.device_id}\nDEVICE_SECRET=${secretValue}`;
	});

	async function copySecret() {
		if (!secretValue) return;
		try {
			await navigator.clipboard.writeText(secretValue);
			copied = true;
			toast.success('คัดลอก Device Secret แล้ว');
			setTimeout(() => (copied = false), 2000);
		} catch {
			toast.error('ไม่สามารถคัดลอกได้');
		}
	}

	async function copyEnvSnippet() {
		if (!envSnippet) return;
		try {
			await navigator.clipboard.writeText(envSnippet);
			copiedEnv = true;
			toast.success('คัดลอก .env config snippet แล้ว');
			setTimeout(() => (copiedEnv = false), 2000);
		} catch {
			toast.error('ไม่สามารถคัดลอกได้');
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-h-[90dvh] gap-3 overflow-y-auto sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title
				class="flex items-center gap-2 text-xl font-bold {isNew
					? 'text-emerald-600'
					: 'text-foreground'}"
			>
				<Key class="h-5 w-5 text-primary" />
				<span>{isNew ? 'ลงทะเบียนอุปกรณ์สำเร็จ' : 'ข้อมูลการติดตั้ง Scanner Key'}</span>
			</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				นำ Device Secret ไปใส่ในไฟล์ <code>.env</code> ของโปรแกรม <code>scanner_client</code> เพื่อยืนยันตัวตนอุปกรณ์
			</Dialog.Description>
		</Dialog.Header>

		{#if device}
			<div class="min-w-0 space-y-4 py-2">
				<div class="rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-900">
					<div class="flex items-start gap-2">
						<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
						<div>
							<p class="font-semibold">ข้อแนะนำความปลอดภัย</p>
							<p class="mt-0.5 leading-relaxed">
								Device Secret เปรียบเสมือนรหัสผ่านของเครื่องอ่านบัตร
								โปรดเก็บรักษาเป็นความลับและใส่ในเครื่องอ่านบัตรประจำจุดบริการเท่านั้น
							</p>
						</div>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
					<div class="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
						<span class="text-muted-foreground">Device ID / ชื่อ:</span>
						<p class="font-mono font-semibold break-all text-foreground">{device.device_id}</p>
						<p class="text-xs text-muted-foreground">{device.name}</p>
					</div>
					<div class="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
						<span class="text-muted-foreground">ศูนย์พักพิง / จุดบริการ:</span>
						<p class="font-mono font-semibold break-all text-foreground">
							{device.shelter_code}
						</p>
						<p class="text-xs text-muted-foreground">{device.station_name}</p>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="device-secret" class="text-sm font-semibold text-slate-700">
						Device Secret (รหัสความปลอดภัย):
					</label>
					<div class="flex flex-col gap-2 sm:flex-row">
						<Input
							id="device-secret"
							readonly
							value={secretValue}
							placeholder="แสดงครั้งเดียวหลังสร้างอุปกรณ์"
							class="min-w-0 flex-1 bg-slate-50 font-mono text-xs select-all"
						/>
						<Button
							variant="outline"
							size="sm"
							onclick={copySecret}
							disabled={!secretValue}
							class="min-h-11 shrink-0 gap-1.5 sm:min-h-9"
						>
							{#if copied}
								<Check class="h-4 w-4 text-emerald-500" />
							{:else}
								<Copy class="h-4 w-4" />
							{/if}
							<span>คัดลอก</span>
						</Button>
					</div>
					{#if !secretValue}
						<p class="text-xs text-amber-800">
							ระบบจะไม่เก็บหรือเปิดเผย Scanner Key แบบข้อความธรรมดาซ้ำ
							หากไม่ได้คัดลอกตอนสร้างอุปกรณ์ ต้องสร้าง credential ใหม่ตามกระบวนการที่ได้รับอนุมัติ
						</p>
					{/if}
				</div>

				{#if staffPinValue}
					<div class="space-y-1.5">
						<p id="new-staff-pin-label" class="text-sm font-semibold text-slate-700">
							PIN เจ้าหน้าที่ (ค่าเริ่มต้น):
						</p>
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
							<output
								aria-labelledby="new-staff-pin-label"
								class="flex min-h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-2xl font-bold tracking-[0.3em] text-[#0A2647] tabular-nums"
							>
								{#if pinVisible}
									{staffPinValue}
								{:else}
									<span aria-hidden="true">••••••</span>
									<span class="sr-only">PIN ถูกซ่อนอยู่</span>
								{/if}
							</output>
							<div class="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									class="min-h-11 flex-1 gap-1.5 sm:flex-none"
									onclick={() => (pinVisible = !pinVisible)}
									aria-pressed={pinVisible}
								>
									{#if pinVisible}
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
									size="sm"
									class="min-h-11 flex-1 gap-1.5 sm:flex-none"
									onclick={copyStaffPin}
								>
									<Copy class="h-4 w-4" />
									<span>คัดลอก</span>
									<span class="sr-only">PIN</span>
								</Button>
							</div>
						</div>
						<p class="flex items-start gap-1.5 text-xs text-slate-500">
							<KeyRound class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>
								ใช้ที่ตู้ kiosk เมื่อเจ้าหน้าที่ต้องข้ามการตรวจใบหน้า เปิดดูหรือเปลี่ยน PIN
								ได้อีกจากรายการเครื่อง แนะนำให้เปลี่ยนจากค่าเริ่มต้น
							</span>
						</p>
					</div>
				{/if}

				<div class="space-y-1.5">
					<div class="flex flex-wrap items-center justify-between gap-1">
						<label for="env-snippet" class="text-xs font-semibold text-muted-foreground">
							ตัวอย่างไฟล์ .env สำหรับ scanner_client:
						</label>
						<Button
							variant="ghost"
							size="sm"
							onclick={copyEnvSnippet}
							disabled={!secretValue}
							class="min-h-11 gap-1 text-xs"
						>
							{#if copiedEnv}
								<Check class="h-3.5 w-3.5 text-emerald-500" />
							{:else}
								<Copy class="h-3.5 w-3.5" />
							{/if}
							<span>คัดลอก .env</span>
						</Button>
					</div>
					<pre
						id="env-snippet"
						class="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-all whitespace-pre-wrap text-slate-800">{envSnippet ||
							'จะแสดงเมื่อสร้างอุปกรณ์ใหม่เท่านั้น'}</pre>
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button class="w-full sm:w-auto" onclick={() => handleOpenChange(false)}>ปิดหน้าต่าง</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
