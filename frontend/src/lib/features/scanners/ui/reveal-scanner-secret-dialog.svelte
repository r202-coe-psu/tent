<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import Key from '@lucide/svelte/icons/key';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import type { CreatedScannerDevice, ScannerDevice } from '../domain/scanner.schema';

	let {
		open = $bindable(false),
		device = null,
		isNew = false
	}: {
		open?: boolean;
		device?: ScannerDevice | CreatedScannerDevice | null;
		isNew?: boolean;
	} = $props();

	let copied = $state(false);
	let copiedEnv = $state(false);
	const deploymentBaseUrl = $derived(
		typeof window === 'undefined' ? 'https://<deployment-host>' : window.location.origin
	);

	const secretValue = $derived.by(() => {
		if (!device) return '';
		const created = device as CreatedScannerDevice;
		return created.plaintext_secret || '';
	});

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

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[560px]">
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
			<div class="space-y-4 py-2">
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
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
						<span class="text-muted-foreground">Device ID / ชื่อ:</span>
						<p class="font-mono font-semibold text-foreground">{device.device_id}</p>
						<p class="text-xs text-muted-foreground">{device.name}</p>
					</div>
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
						<span class="text-muted-foreground">ศูนย์พักพิง / จุดบริการ:</span>
						<p class="font-mono font-semibold text-foreground">
							{device.shelter_code}
						</p>
						<p class="text-xs text-muted-foreground">{device.station_name}</p>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="device-secret" class="text-sm font-semibold text-slate-700">
						Device Secret (รหัสความปลอดภัย):
					</label>
					<div class="flex gap-2">
						<Input
							id="device-secret"
							readonly
							value={secretValue}
							placeholder="แสดงครั้งเดียวหลังสร้างอุปกรณ์"
							class="bg-slate-50 font-mono text-xs select-all"
						/>
						<Button
							variant="outline"
							size="sm"
							onclick={copySecret}
							disabled={!secretValue}
							class="shrink-0 gap-1.5"
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

				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
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
						class="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">{envSnippet ||
							'จะแสดงเมื่อสร้างอุปกรณ์ใหม่เท่านั้น'}</pre>
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button class="w-full sm:w-auto" onclick={() => (open = false)}>ปิดหน้าต่าง</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
