<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import AlignCenter from '@lucide/svelte/icons/text-align-center';
	import AlignLeft from '@lucide/svelte/icons/text-align-start';
	import AlignRight from '@lucide/svelte/icons/text-align-end';
	import Check from '@lucide/svelte/icons/check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { KioskBannerFormValues } from '../domain/kiosk-banner-form';
	import {
		BANNER_COLOR_PRESETS,
		KIOSK_BANNER_TEMPLATE_LIMITS,
		bannerColorSchema,
		isHardToRead,
		type KioskBannerTemplateAlign
	} from '../domain/kiosk-banner-template';

	/**
	 * Fields of the template banner: heading, body, alignment, two colours and an optional logo.
	 * Values live in the parent superform (`template.*`); the logo file itself belongs to the
	 * parent (it is not part of the schema), which is told through the callbacks.
	 */
	let {
		form,
		logoName,
		hasLogo,
		logoError,
		onchooselogo,
		onremovelogo,
		logoInput = $bindable(null),
		disabled = false
	}: {
		form: SuperForm<KioskBannerFormValues>;
		/** File name of a newly chosen logo. */
		logoName: string | null;
		/** A logo is set: newly chosen or the stored one kept. */
		hasLogo: boolean;
		logoError: string | null;
		onchooselogo: (file: File | null) => void;
		onremovelogo: () => void;
		/** The logo file input, so the parent can focus it when the logo blocks a save. */
		logoInput?: HTMLInputElement | null;
		/** Locks the fields while the PNG is rendered, so it matches the template that is saved. */
		disabled?: boolean;
	} = $props();

	// The form is created once by the parent for the lifetime of this editor.
	// svelte-ignore state_referenced_locally
	const { form: formData } = form;

	const ALIGNS: { value: KioskBannerTemplateAlign; label: string; icon: typeof AlignLeft }[] = [
		{ value: 'left', label: 'ซ้าย', icon: AlignLeft },
		{ value: 'center', label: 'กลาง', icon: AlignCenter },
		{ value: 'right', label: 'ขวา', icon: AlignRight }
	];

	const isColor = (value: string) => bannerColorSchema.safeParse(value).success;
	const hardToRead = $derived(
		isColor($formData.template.bg_color) &&
			isColor($formData.template.text_color) &&
			isHardToRead($formData.template.bg_color, $formData.template.text_color)
	);

	function handleLogoChange(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		onchooselogo(input.files?.[0] ?? null);
		input.value = '';
	}
</script>

{#snippet colorField(name: 'bg_color' | 'text_color', label: string)}
	<Form.Field {form} name="template.{name}" class="space-y-2">
		<span class="text-sm font-medium">{label}</span>
		<div role="group" aria-label={label} class="flex flex-wrap gap-2">
			{#each BANNER_COLOR_PRESETS as preset (preset.value)}
				{@const pressed = $formData.template[name].toLowerCase() === preset.value}
				<button
					type="button"
					aria-label={preset.label}
					aria-pressed={pressed}
					title={preset.label}
					class="flex size-11 items-center justify-center rounded-lg border-2 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none {pressed
						? 'border-slate-900'
						: 'border-slate-300'}"
					style:background-color={preset.value}
					onclick={() => ($formData.template[name] = preset.value)}
				>
					{#if pressed}
						<Check
							class="size-5"
							style="color: {isHardToRead(preset.value, '#ffffff') ? '#ffffff' : '#000000'}"
						/>
					{/if}
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-2">
			<Input
				id="banner-template-{name}-picker"
				type="color"
				aria-label="{label} (เลือกสีเอง)"
				class="h-11 w-14 cursor-pointer p-1"
				value={isColor($formData.template[name]) ? $formData.template[name] : '#000000'}
				oninput={(event) => ($formData.template[name] = event.currentTarget.value)}
			/>
			<Form.Control id="banner-template-{name}-hex">
				{#snippet children({ props })}
					<Label class="sr-only" for={props.id}>{label} (รหัสสี #RRGGBB)</Label>
					<Input
						{...props}
						class="h-11 max-w-32 tabular-nums"
						maxlength={7}
						placeholder="#RRGGBB"
						bind:value={$formData.template[name]}
					/>
				{/snippet}
			</Form.Control>
		</div>
		<Form.FieldErrors />
	</Form.Field>
{/snippet}

<fieldset class="min-w-0 space-y-4" {disabled}>
	<Form.Field {form} name="template.heading">
		<Form.Control id="banner-template-heading">
			{#snippet children({ props })}
				<Form.Label>หัวข้อ</Form.Label>
				<Input
					{...props}
					class="h-11"
					maxlength={KIOSK_BANNER_TEMPLATE_LIMITS.headingMax}
					bind:value={$formData.template.heading}
				/>
			{/snippet}
		</Form.Control>
		<Form.FieldErrors />
	</Form.Field>

	<Form.Field {form} name="template.body">
		<Form.Control id="banner-template-body">
			{#snippet children({ props })}
				<Form.Label>เนื้อหา</Form.Label>
				<Textarea
					{...props}
					rows={5}
					maxlength={KIOSK_BANNER_TEMPLATE_LIMITS.bodyMax}
					bind:value={$formData.template.body}
				/>
			{/snippet}
		</Form.Control>
		<Form.Description class="text-xs text-slate-500">
			ขึ้นบรรทัดใหม่ได้ · ไม่เกิน {KIOSK_BANNER_TEMPLATE_LIMITS.bodyMax} ตัวอักษร
		</Form.Description>
		<Form.FieldErrors />
	</Form.Field>

	<div class="space-y-2">
		<span class="text-sm font-medium">จัดชิด</span>
		<div role="group" aria-label="จัดชิด" class="grid grid-cols-3 gap-2">
			{#each ALIGNS as align (align.value)}
				<Button
					type="button"
					variant={$formData.template.align === align.value ? 'default' : 'outline'}
					aria-pressed={$formData.template.align === align.value}
					class="min-h-11 gap-2"
					onclick={() => ($formData.template.align = align.value)}
				>
					<align.icon class="size-4" />
					{align.label}
				</Button>
			{/each}
		</div>
	</div>

	{@render colorField('bg_color', 'สีพื้นหลัง')}
	{@render colorField('text_color', 'สีตัวอักษร')}

	<!-- The live region stays mounted so screen readers announce the warning when it appears. -->
	<div role="status">
		{#if hardToRead}
			<p
				class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900"
			>
				<TriangleAlert class="mt-0.5 size-4 shrink-0" />
				สีตัวอักษรกับสีพื้นอ่านยาก
			</p>
		{/if}
	</div>

	<div class="space-y-2">
		<Label for="banner-template-image" class={logoError ? 'text-destructive' : undefined}>
			รูป/โลโก้ (ไม่บังคับ)
		</Label>
		<Input
			id="banner-template-image"
			bind:ref={logoInput}
			type="file"
			accept="image/png,image/jpeg,image/webp"
			class="h-11"
			aria-invalid={logoError ? true : undefined}
			aria-describedby={logoError ? 'banner-template-image-error' : undefined}
			onchange={handleLogoChange}
		/>
		<p class="text-xs text-slate-500">
			png / jpeg / webp · ระบบย่อรูปให้อัตโนมัติ
			{#if logoName}· เลือกแล้ว: {logoName}{:else if hasLogo}· ใช้รูปเดิม{/if}
		</p>
		{#if logoError}
			<p id="banner-template-image-error" class="text-sm font-medium text-destructive">
				{logoError}
			</p>
		{/if}
		{#if hasLogo}
			<Button type="button" variant="outline" class="min-h-11 gap-2" onclick={onremovelogo}>
				<Trash2 class="size-4" />
				ลบรูป/โลโก้
			</Button>
		{/if}
	</div>
</fieldset>
