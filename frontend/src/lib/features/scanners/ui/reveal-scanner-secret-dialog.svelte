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

	const secretValue = $derived.by(() => {
		if (!device) return '';
		const created = device as CreatedScannerDevice;
		return created.plaintext_secret || '';
	});

	const envSnippet = $derived.by(() => {
		if (!device) return '';
		return `TENT_BASE_URL=http://localhost:5173\nDEVICE_ID=${device.device_id}\nDEVICE_SECRET=${secretValue || device.secret_prefix}`;
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
				<span>{isNew ? 'ลงทะเบียนอุปกรณ์สำเร็จ' : 'ข้อมูล Device Secret'}</span>
			</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				นำ Device Secret ไปใส่ในไฟล์ <code>.env</code> ของโปรแกรม <code>scanner_client</code> เพื่อยืนยันตัวตนอุปกรณ์
			</Dialog.Description>
		</Dialog.Header>

		{#if device}
			<div class="space-y-4 py-2">
				<div
					class="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-800 dark:text-blue-200"
				>
					<div class="flex items-start gap-2">
						<ShieldAlert class="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
						<div>
							<p class="font-semibold">ข้อแนะนำความปลอดภัย</p>
							<p class="mt-0.5 leading-relaxed">
								Device Secret เปรียบเสมือนรหัสผ่านของเครื่องอ่านบัตร
								โปรดเก็บรักษาเป็นความลับและใส่ในเครื่องอ่านบัตรประจำจุดบริการเท่านั้น
							</p>
						</div>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3 text-xs">
					<div class="rounded-lg bg-muted/60 p-2.5">
						<span class="text-muted-foreground">Device ID / ชื่อ:</span>
						<p class="font-mono font-semibold text-foreground">{device.device_id}</p>
						<p class="text-[11px] text-muted-foreground">{device.name}</p>
					</div>
					<div class="rounded-lg bg-muted/60 p-2.5">
						<span class="text-muted-foreground">ศูนย์พักพิง / จุดบริการ:</span>
						<p class="font-mono font-semibold text-foreground">
							{device.shelter_code}
						</p>
						<p class="text-[11px] text-muted-foreground">{device.station_name}</p>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="device-secret" class="text-xs font-semibold text-muted-foreground">
						Device Secret (รหัสความปลอดภัย):
					</label>
					<div class="flex gap-2">
						<Input
							id="device-secret"
							readonly
							value={secretValue || device.secret_prefix}
							class="bg-muted/50 font-mono text-xs select-all"
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
						<p class="text-[11px] text-amber-600">
							(เพื่อความปลอดภัย ระบบจะไม่จัดเก็บรหัสผ่านแบบข้อความธรรมดา แสดงเฉพาะ Prefix: {device.secret_prefix})
						</p>
					{/if}
				</div>

				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<label for="env-snippet" class="text-xs font-semibold text-muted-foreground">
							ตัวอย่างไฟล์ .env สำหรับ scanner_client:
						</label>
						<Button variant="ghost" size="sm" onclick={copyEnvSnippet} class="h-7 gap-1 text-xs">
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
						class="overflow-x-auto rounded-lg border border-border bg-muted/70 p-3 font-mono text-xs text-foreground">{envSnippet}</pre>
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button class="w-full sm:w-auto" onclick={() => (open = false)}>ปิดหน้าต่าง</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
