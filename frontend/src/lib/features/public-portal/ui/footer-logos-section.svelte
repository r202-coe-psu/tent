<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import * as Card from '$lib/components/ui/card';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { FOOTER_LOGO_MAX, type FooterLogoRecord } from '../domain/footer-logo';
	import FooterLogoDialog from './footer-logo-dialog.svelte';
	import { logoActionResult } from './footer-logo-action';

	let {
		logos,
		rev,
		canEdit
	}: {
		logos: FooterLogoRecord[];
		rev: string;
		canEdit: boolean;
	} = $props();

	let dialogOpen = $state(false);
	let dialogKey = $state(0);
	let editing = $state<FooterLogoRecord | null>(null);
	let deleting = $state<FooterLogoRecord | null>(null);
	let pending = $state(false);

	const atLimit = $derived(logos.length >= FOOTER_LOGO_MAX);

	function openDialog(logo: FooterLogoRecord | null) {
		editing = logo;
		dialogKey += 1;
		dialogOpen = true;
	}

	const submitRow: SubmitFunction = () => {
		pending = true;
		return async ({ result, update }) => {
			pending = false;
			if (logoActionResult(result, toast)) deleting = null;
			await update({ reset: false });
		};
	};
</script>

{#snippet rowAction(
	action: string,
	logo: FooterLogoRecord,
	label: string,
	extra: Record<string, string>,
	disabled: boolean,
	icon: typeof Eye
)}
	{@const Icon = icon}
	<form method="POST" {action} use:enhance={submitRow}>
		<input type="hidden" name="rev" value={rev} />
		<input type="hidden" name="id" value={logo.id} />
		{#each Object.entries(extra) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<Button
			type="submit"
			variant="outline"
			size="icon"
			class="size-11"
			disabled={disabled || pending}
			title={label}
		>
			<Icon class="size-4" />
			<span class="sr-only">{label}</span>
		</Button>
	</form>
{/snippet}

<Card.Root class="overflow-hidden rounded-xl border border-slate-200/80 py-0 shadow-2xs">
	<div
		class="flex flex-col gap-3 border-b border-slate-200/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex items-center gap-3">
			<div class="rounded-lg bg-primary/10 p-2 text-primary">
				<ImageIcon class="h-5 w-5" />
			</div>
			<div>
				<Card.Title class="text-lg">โลโก้หน่วยงานที่สนับสนุน</Card.Title>
				<Card.Description class="mt-1">
					แสดงที่ส่วนท้ายของหน้าเว็บสาธารณะตามลำดับ · สูงสุด {FOOTER_LOGO_MAX} รายการ
				</Card.Description>
			</div>
		</div>
		{#if canEdit}
			<Button class="min-h-11" disabled={atLimit} onclick={() => openDialog(null)}>
				<Plus class="mr-1.5 size-4" /> เพิ่มโลโก้
			</Button>
		{/if}
	</div>

	<Card.Content class="p-0">
		{#if !canEdit}
			<p
				class="m-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
			>
				ดูได้อย่างเดียว — เฉพาะผู้ดูแลระบบ (System Admin) แก้ไขโลโก้ได้
			</p>
		{/if}

		{#if logos.length === 0}
			<p class="px-6 py-10 text-center text-sm text-slate-500">
				ยังไม่มีโลโก้ · footer จะไม่แสดงแถวโลโก้
			</p>
		{:else}
			<ul class="divide-y divide-slate-200/80">
				{#each logos as logo, i (logo.id)}
					<li class="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
						<div
							class="flex h-16 w-32 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-white p-2"
						>
							{#if logo.image_url}
								<img
									src={logo.image_url}
									alt={logo.alt_th}
									class="max-h-full max-w-full object-contain"
								/>
							{:else}
								<span class="text-xs text-slate-500">ไม่มีรูป</span>
							{/if}
						</div>

						<div class="min-w-0 flex-1 space-y-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-sm text-slate-500 tabular-nums">#{logo.order}</span>
								<span class="font-semibold text-slate-900">{logo.alt_th}</span>
								{#if logo.is_published}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900"
									>
										<Eye class="size-3" /> แสดง
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"
									>
										<EyeOff class="size-3" /> ซ่อน
									</span>
								{/if}
							</div>
							{#if logo.alt_en}
								<p class="truncate text-sm text-slate-500">{logo.alt_en}</p>
							{/if}
							{#if logo.link_url}
								<p class="truncate text-sm text-sky-700">{logo.link_url}</p>
							{/if}
						</div>

						{#if canEdit}
							<div class="flex flex-wrap items-center gap-2">
								{@render rowAction(
									'?/moveLogo',
									logo,
									'เลื่อนขึ้น',
									{ direction: 'up' },
									i === 0,
									ArrowUp
								)}
								{@render rowAction(
									'?/moveLogo',
									logo,
									'เลื่อนลง',
									{ direction: 'down' },
									i === logos.length - 1,
									ArrowDown
								)}
								{@render rowAction(
									'?/toggleLogo',
									logo,
									logo.is_published ? 'ซ่อนโลโก้' : 'แสดงโลโก้',
									{ is_published: String(!logo.is_published) },
									false,
									logo.is_published ? EyeOff : Eye
								)}
								<Button
									variant="outline"
									size="icon"
									class="size-11"
									title="แก้ไข"
									onclick={() => openDialog(logo)}
								>
									<Pencil class="size-4" />
									<span class="sr-only">แก้ไข</span>
								</Button>
								<Button
									variant="outline"
									size="icon"
									class="size-11 text-red-600 hover:text-red-700"
									title="ลบ"
									onclick={() => (deleting = logo)}
								>
									<Trash2 class="size-4" />
									<span class="sr-only">ลบ</span>
								</Button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>

{#if canEdit}
	{#key dialogKey}
		<FooterLogoDialog bind:open={dialogOpen} logo={editing} {rev} />
	{/key}

	<AlertDialog.Root
		open={deleting !== null}
		onOpenChange={(open) => {
			if (!open) deleting = null;
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>ลบโลโก้นี้?</AlertDialog.Title>
				<AlertDialog.Description>
					「{deleting?.alt_th}」จะถูกลบพร้อมรูป และหายจาก footer ทันที
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
				<form method="POST" action="?/deleteLogo" use:enhance={submitRow}>
					<input type="hidden" name="rev" value={rev} />
					<input type="hidden" name="id" value={deleting?.id ?? ''} />
					<Button type="submit" variant="destructive" disabled={pending}>ลบโลโก้</Button>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
