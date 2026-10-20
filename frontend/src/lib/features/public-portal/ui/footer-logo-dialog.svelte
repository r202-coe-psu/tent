<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { validateBannerFile } from '$lib/features/kiosk-banners';
	import type { FooterLogoRecord } from '../domain/footer-logo';
	import { logoActionResult } from './footer-logo-action';

	let {
		open = $bindable(false),
		logo,
		rev
	}: {
		open: boolean;
		/** `null` = create */
		logo: FooterLogoRecord | null;
		rev: string;
	} = $props();

	// The parent re-mounts this dialog (`{#key}`) per open, so fields start from the row once.
	const initial = untrack(() => logo);
	let altTh = $state(initial?.alt_th ?? '');
	let altEn = $state(initial?.alt_en ?? '');
	let linkUrl = $state(initial?.link_url ?? '');
	let isPublished = $state(initial?.is_published ?? true);
	let file = $state<File | null>(null);
	let fileError = $state<string | null>(null);
	let submitting = $state(false);

	const isEdit = $derived(logo !== null);
	const previewUrl = $derived(file ? URL.createObjectURL(file) : null);

	$effect(() => {
		const url = previewUrl;
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	});

	function onFileChange(event: Event) {
		const picked = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
		fileError = picked ? validateBannerFile(picked) : null;
		file = picked && !fileError ? picked : null;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[520px]">
		<form
			method="POST"
			action={isEdit ? '?/updateLogo' : '?/createLogo'}
			enctype="multipart/form-data"
			class="space-y-4"
			use:enhance={({ cancel }) => {
				if (!isEdit && !file) {
					fileError = 'กรุณาเลือกรูปโลโก้';
					cancel();
					return;
				}
				submitting = true;
				return async ({ result, update }) => {
					submitting = false;
					if (logoActionResult(result, toast)) open = false;
					await update({ reset: false });
				};
			}}
		>
			<Dialog.Header>
				<Dialog.Title>{isEdit ? 'แก้ไขโลโก้' : 'เพิ่มโลโก้หน่วยงาน'}</Dialog.Title>
				<Dialog.Description>โลโก้จะแสดงที่ส่วนท้าย (footer) ของหน้าเว็บสาธารณะ</Dialog.Description>
			</Dialog.Header>

			<input type="hidden" name="rev" value={rev} />
			{#if logo}
				<input type="hidden" name="id" value={logo.id} />
			{/if}
			<input type="hidden" name="is_published" value={String(isPublished)} />

			<div class="space-y-2">
				<Label for="footer-logo-image" class="text-sm font-semibold text-slate-700">
					รูปโลโก้ {#if !isEdit}<span class="text-red-500">*</span>{/if}
				</Label>
				<Input
					id="footer-logo-image"
					name="image"
					type="file"
					accept="image/png,image/jpeg,image/webp"
					onchange={onFileChange}
					aria-invalid={fileError ? true : undefined}
				/>
				<p class="text-xs text-slate-500">
					รองรับ png / jpeg / webp ขนาดไม่เกิน 2 MB{isEdit ? ' · ไม่เลือกรูป = ใช้รูปเดิม' : ''}
				</p>
				{#if fileError}
					<p class="text-xs font-semibold text-red-600">{fileError}</p>
				{/if}
				{#if previewUrl || logo?.image_url}
					<div
						class="flex h-20 items-center justify-center rounded-lg border border-slate-200/80 bg-white p-3"
					>
						<img
							src={previewUrl ?? logo?.image_url}
							alt="ตัวอย่างโลโก้"
							class="h-10 w-auto max-w-40 object-contain"
						/>
					</div>
				{/if}
			</div>

			<div class="space-y-2">
				<Label for="footer-logo-alt-th" class="text-sm font-semibold text-slate-700">
					ชื่อหน่วยงาน (ไทย) <span class="text-red-500">*</span>
				</Label>
				<Input
					id="footer-logo-alt-th"
					name="alt_th"
					bind:value={altTh}
					required
					maxlength={120}
					placeholder="เช่น มหาวิทยาลัยสงขลานครินทร์"
				/>
				<p class="text-xs text-slate-500">ใช้เป็นข้อความแทนรูป (alt) สำหรับโปรแกรมอ่านหน้าจอ</p>
			</div>

			<div class="space-y-2">
				<Label for="footer-logo-alt-en" class="text-sm font-semibold text-slate-700">
					ชื่อหน่วยงาน (English)
				</Label>
				<Input
					id="footer-logo-alt-en"
					name="alt_en"
					bind:value={altEn}
					maxlength={120}
					placeholder="e.g. Prince of Songkla University"
				/>
			</div>

			<div class="space-y-2">
				<Label for="footer-logo-link" class="text-sm font-semibold text-slate-700">ลิงก์</Label>
				<Input
					id="footer-logo-link"
					name="link_url"
					type="url"
					bind:value={linkUrl}
					placeholder="https://www.psu.ac.th"
				/>
				<p class="text-xs text-slate-500">ต้องขึ้นต้นด้วย https:// · เว้นว่างได้</p>
			</div>

			<div class="flex items-center justify-between rounded-lg border border-slate-200/80 p-3">
				<div>
					<Label for="footer-logo-published" class="text-sm font-semibold text-slate-700">
						การเผยแพร่
					</Label>
					<p class="text-sm text-slate-500">แสดงโลโก้นี้ในหน้าเว็บ</p>
				</div>
				<Switch id="footer-logo-published" bind:checked={isPublished} />
			</div>

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
				<Button type="submit" disabled={submitting}>
					{submitting ? 'กำลังบันทึก...' : 'บันทึก'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
