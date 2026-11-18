<script lang="ts">
	import { untrack } from 'svelte';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import {
		DONATION_REJECT_REASON_SELECTABLE_CODES,
		DONATION_REJECT_REASON_LABELS,
		REJECT_NOTE_MAX,
		containsRejectNoteTemplate,
		donorRejectMessage,
		noteForReason,
		type DonationRejectReasonCode
	} from '../domain/reject-reason';

	/**
	 * Preset reason + detail + what the donor will read (CR-172 FR-6, FR-7, FR-9).
	 *
	 * The reason is shown on the public tracking page as typed — there is no internal
	 * note — so the preview and the warning sit right under the field.
	 */
	let {
		code = $bindable(),
		note = $bindable(''),
		idPrefix,
		disabled = false
	}: {
		code?: DonationRejectReasonCode;
		note?: string;
		/** Keeps the radio/textarea ids unique when several lines render this at once. */
		idPrefix: string;
		disabled?: boolean;
	} = $props();

	const noteRequired = $derived(code === 'other');
	const preview = $derived(code ? donorRejectMessage(code, note) : '');
	/**
	 * Picking a reason puts its formal message in the detail for staff to edit. While that message is
	 * untouched, changing the reason swaps (or drops) it. Once staff reworded or removed it, the text
	 * is theirs and a new reason leaves it alone. A detail that is already written when this mounts
	 * (the parent remounts it when a line's decision is toggled) counts as filled, so the message is
	 * not stacked after it.
	 */
	let filled = untrack(() => note.trim() !== '');
	function pickReason(next: DonationRejectReasonCode) {
		code = next;
		if (filled && note.trim() !== '' && !containsRejectNoteTemplate(note)) return;
		note = noteForReason(note, next);
		filled = containsRejectNoteTemplate(note);
	}

	/** The "other" option spans both columns; the rest sit side by side. */
	const optionClass = (option: string) =>
		`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium ${option === 'other' ? 'sm:col-span-2' : ''}`;
</script>

<div class="space-y-3">
	<RadioGroup.Root
		bind:value={() => code ?? '', (next) => pickReason(next as DonationRejectReasonCode)}
		{disabled}
		aria-label="เหตุผลที่ไม่รับ"
		class="grid grid-cols-1 gap-2 sm:grid-cols-2"
	>
		{#each DONATION_REJECT_REASON_SELECTABLE_CODES as option (option)}
			<Label for="{idPrefix}-code-{option}" class={optionClass(option)}>
				<RadioGroup.Item id="{idPrefix}-code-{option}" value={option} />
				{DONATION_REJECT_REASON_LABELS[option]}
			</Label>
		{/each}
	</RadioGroup.Root>

	<div class="space-y-1.5">
		<Label for="{idPrefix}-note" class="text-xs font-semibold text-muted-foreground">
			รายละเอียดเพิ่มเติม
			{#if noteRequired}<span class="text-destructive">*</span>{:else}(ไม่บังคับ){/if}
		</Label>
		<Textarea
			id="{idPrefix}-note"
			bind:value={note}
			{disabled}
			required={noteRequired}
			aria-required={noteRequired}
			rows={2}
			maxlength={REJECT_NOTE_MAX}
			placeholder="เช่น นมกล่องหมดอายุ 2 กล่อง"
			class="text-xs"
		/>
		<p class="text-2xs text-amber-700 dark:text-amber-300">
			ผู้บริจาคจะเห็นข้อความนี้บนหน้าติดตาม — ห้ามใส่ชื่อ เบอร์โทร หรือข้อมูลส่วนตัว
		</p>
	</div>

	{#if preview}
		<div class="rounded-xl border border-dashed border-border bg-muted/40 p-3">
			<p class="text-2xs font-bold text-muted-foreground">ผู้บริจาคจะเห็น</p>
			<p class="mt-1 text-xs break-words text-foreground" data-testid="{idPrefix}-preview">
				{preview}
			</p>
		</div>
	{/if}
</div>
