<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import type { CreatedScannerDevice } from '../domain/scanner.schema';

	let {
		open = $bindable(false),
		created = null
	}: {
		open?: boolean;
		created?: CreatedScannerDevice | null;
	} = $props();

	let copied = $state(false);
	let copiedEnv = $state(false);

	const envSnippet = $derived.by(() => {
		if (!created) return '';
		return `TENT_BASE_URL=http://localhost:5173\nDEVICE_ID=${created.device_id}\nDEVICE_SECRET=${created.plaintext_secret}`;
	});

	async function copySecret() {
		if (!created?.plaintext_secret) return;
		try {
			await navigator.clipboard.writeText(created.plaintext_secret);
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
			<Dialog.Title class="flex items-center gap-2 text-xl font-bold text-emerald-600">
				<span>ลงทะเบียนอุปกรณ์สำเร็จ</span>
			</Dialog.Title>
			<Dialog.Description class="text-sm text-muted-foreground">
				คัดลอก Device Secret เพื่อนำไปใส่ในไฟล์ <code>.env</code> ของ <code>scanner_client</code>
			</Dialog.Description>
		</Dialog.Header>

		{#if created}
			<div class="space-y-4 py-2">
				<div
					class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-700 dark:text-amber-300"
				>
					<div class="flex items-start gap-2">
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
						<div>
							<p class="font-semibold">โปรดบันทึก Secret นี้ไว้ทันที</p>
							<p class="mt-0.5">
								ระบบจะแสดง Secret ตัวเต็มนี้เพียงครั้งเดียวเท่านั้น
								เพื่อความปลอดภัยจะไม่สามารถดูซ้ำได้อีก
							</p>
						</div>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3 text-xs">
					<div class="rounded-lg bg-muted/60 p-2.5">
						<span class="text-muted-foreground">Device ID:</span>
						<p class="font-mono font-semibold text-foreground">{created.device_id}</p>
					</div>
					<div class="rounded-lg bg-muted/60 p-2.5">
						<span class="text-muted-foreground">ศูนย์พักพิง:</span>
						<p class="font-mono font-semibold text-foreground">
							{created.shelter_code} ({created.station_name})
						</p>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="device-secret" class="text-xs font-semibold text-muted-foreground"
						>Device Secret:</label
					>
					<div class="flex gap-2">
						<Input
							id="device-secret"
							readonly
							value={created.plaintext_secret}
							class="bg-muted/50 font-mono text-xs select-all"
						/>
						<Button variant="outline" size="sm" onclick={copySecret} class="shrink-0 gap-1.5">
							{#if copied}
								<Check class="h-4 w-4 text-emerald-500" />
							{:else}
								<Copy class="h-4 w-4" />
							{/if}
							<span>คัดลอก</span>
						</Button>
					</div>
				</div>

				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<label for="env-snippet" class="text-xs font-semibold text-muted-foreground"
							>ตัวอย่างไฟล์ .env สำหรับ scanner_client:</label
						>
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
