<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import Camera from '@lucide/svelte/icons/camera';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import type { Html5QrcodeSupportedFormats } from 'html5-qrcode';
	import CameraCodeScanner from './camera-code-scanner.svelte';

	let {
		open = $bindable(false),
		title = 'สแกนบาร์โค้ด',
		hint = 'เล็งกล้องไปที่บาร์โค้ด หรือพิมพ์รหัสด้วยมือ / เครื่องสแกนบาร์โค้ด',
		formats,
		manualInputMode = 'numeric',
		onScan
	}: {
		open?: boolean;
		title?: string;
		hint?: string;
		/** Symbologies the camera decodes; the scanner's 1D retail default when omitted. */
		formats?: Html5QrcodeSupportedFormats[];
		/** Keyboard for the typed fallback — `text` for alphanumeric codes such as QR payloads. */
		manualInputMode?: 'numeric' | 'text';
		/** Receives a camera read or a typed code; the dialog closes first. */
		onScan: (code: string) => void;
	} = $props();

	let manualCode = $state('');

	function deliver(code: string) {
		const clean = code.trim();
		if (!clean) return;
		manualCode = '';
		open = false;
		onScan(clean);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex w-full max-w-md flex-col gap-5 rounded-2xl p-6">
		<Dialog.Header class="pr-6 text-left">
			<Dialog.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
				<Camera class="size-5 text-primary" aria-hidden="true" />
				{title}
			</Dialog.Title>
			<Dialog.Description class="text-sm text-slate-500">{hint}</Dialog.Description>
		</Dialog.Header>

		<!-- Mounted only while open so the camera is released when the dialog closes. -->
		{#if open}
			<CameraCodeScanner onScan={deliver} {formats} />
		{/if}

		<form
			onsubmit={(e) => {
				e.preventDefault();
				deliver(manualCode);
			}}
			class="space-y-2"
		>
			<Label
				for="camera-code-manual"
				class="flex items-center gap-1.5 text-sm font-semibold text-slate-700"
			>
				<Keyboard class="size-4" aria-hidden="true" />
				หรือพิมพ์รหัส
			</Label>
			<div class="flex gap-2">
				<Input
					id="camera-code-manual"
					type="text"
					inputmode={manualInputMode}
					autocomplete="off"
					placeholder="พิมพ์หรือยิงเครื่องสแกนบาร์โค้ด"
					bind:value={manualCode}
					class="h-11 flex-1"
				/>
				<Button type="submit" disabled={!manualCode.trim()} class="min-h-11 px-5 font-bold">
					ตกลง
				</Button>
			</div>
		</form>

		<div class="flex justify-end border-t border-slate-200/80 pt-3">
			<Button type="button" variant="outline" class="min-h-11" onclick={() => (open = false)}>
				ยกเลิก
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
