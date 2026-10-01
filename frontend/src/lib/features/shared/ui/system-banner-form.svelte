<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import Save from '@lucide/svelte/icons/save';
	import SystemBanner from '$lib/components/system-banner.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import {
		BANNER_MESSAGE_MAX,
		bannerPatchSchema,
		isBannerVisible,
		type AppConfig,
		type BannerVariant
	} from '../domain/app-config';
	import { useUpdateAppConfig } from '../application/app-config-queries';

	interface Props {
		config: AppConfig;
	}

	let { config }: Props = $props();

	const VARIANT_OPTIONS: { value: BannerVariant; label: string; swatch: string }[] = [
		{ value: 'success', label: 'สำเร็จ (Success)', swatch: 'bg-emerald-500' },
		{ value: 'warning', label: 'เตือน (Warning)', swatch: 'bg-amber-500' },
		{ value: 'destructive', label: 'อันตราย (Destructive)', swatch: 'bg-red-600' },
		{ value: 'info', label: 'ข้อมูล (Info)', swatch: 'bg-sky-500' }
	];

	const updateMutation = useUpdateAppConfig();

	const initial = untrack(() => ({
		banner_enabled: config.banner_enabled,
		banner_message: config.banner_message,
		banner_variant: config.banner_variant
	}));

	const form = superForm(defaults(initial, zod4(bannerPatchSchema)), {
		SPA: true,
		id: 'system-banner-settings',
		validators: zod4(bannerPatchSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณาตรวจสอบข้อมูลที่กรอกให้ถูกต้อง');
				return;
			}
			try {
				await updateMutation.mutateAsync(validated.data);
				toast.success('บันทึกการตั้งค่าแบนเนอร์ระบบแล้ว');
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'บันทึกการตั้งค่าไม่สำเร็จ');
			}
		}
	});
	const { form: formData, errors, submitting, enhance } = form;

	const previewMessage = $derived($formData.banner_message.trim());
	const previewVisible = $derived(
		isBannerVisible({ banner_enabled: $formData.banner_enabled, banner_message: previewMessage })
	);
	const busy = $derived($submitting || updateMutation.isPending);
</script>

<form method="POST" use:enhance class="space-y-6 px-5 py-5 sm:px-6">
	<div class="flex items-center justify-between gap-4">
		<div class="min-w-0 space-y-1">
			<Label for="banner-enabled" class="text-sm font-semibold text-slate-900">
				แสดงแบนเนอร์ระบบ
			</Label>
			<p class="text-sm text-slate-500">
				แสดงแถบข้อความด้านล่างทุกหน้า — หากไม่ระบุข้อความ จะไม่แสดงแม้เปิดใช้งาน
			</p>
		</div>
		<Switch
			id="banner-enabled"
			checked={$formData.banner_enabled}
			onCheckedChange={(v) => ($formData.banner_enabled = v === true)}
			disabled={busy}
			aria-label="แสดงแบนเนอร์ระบบ"
		/>
	</div>

	<div class="space-y-1.5">
		<Label for="banner-message" class="text-sm font-semibold text-slate-700">ข้อความ</Label>
		<Input
			id="banner-message"
			bind:value={$formData.banner_message}
			maxlength={BANNER_MESSAGE_MAX}
			placeholder="เช่น ระบบอยู่ในช่วงการทดสอบ"
			aria-invalid={$errors.banner_message ? 'true' : undefined}
			disabled={busy}
			class="h-11 sm:h-10"
		/>
		<div class="flex items-start justify-between gap-3">
			<p class="text-sm text-red-700">{$errors.banner_message?.[0] ?? ''}</p>
			<p class="text-xs text-slate-500 tabular-nums">
				{$formData.banner_message.length}/{BANNER_MESSAGE_MAX}
			</p>
		</div>
	</div>

	<div class="space-y-2">
		<Label class="text-sm font-semibold text-slate-700">สี</Label>
		<RadioGroup.Root
			bind:value={$formData.banner_variant}
			disabled={busy}
			class="grid grid-cols-1 gap-3 sm:grid-cols-2"
		>
			{#each VARIANT_OPTIONS as option (option.value)}
				<Label
					for="banner-variant-{option.value}"
					class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-2xs"
				>
					<RadioGroup.Item id="banner-variant-{option.value}" value={option.value} />
					<span class="size-3 shrink-0 rounded-full {option.swatch}" aria-hidden="true"></span>
					{option.label}
				</Label>
			{/each}
		</RadioGroup.Root>
	</div>

	<div class="space-y-2">
		<Label class="text-sm font-semibold text-slate-700">ตัวอย่าง</Label>
		<div class="overflow-hidden rounded-xl border border-slate-200/80">
			{#if previewVisible}
				<SystemBanner message={previewMessage} variant={$formData.banner_variant} fixed={false} />
			{:else}
				<p class="bg-slate-100 px-3 py-1 text-center text-sm text-slate-500">
					{$formData.banner_enabled
						? 'ไม่แสดงแบนเนอร์ — ยังไม่ได้ระบุข้อความ'
						: 'ปิดอยู่ — ไม่แสดงแบนเนอร์'}
				</p>
			{/if}
		</div>
	</div>

	<div class="flex justify-end">
		<Button type="submit" disabled={busy} class="min-h-11 w-full sm:w-auto">
			<Save class="size-4" aria-hidden="true" />
			{busy ? 'กำลังบันทึก…' : 'บันทึก'}
		</Button>
	</div>
</form>
