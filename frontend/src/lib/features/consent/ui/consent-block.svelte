<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import type { ConsentBlockState } from '../application/consent-block.svelte';
	import type { ConsentDecision } from '../domain/consent';
	import { CONSENT_COPY as copy } from '../domain/consent-notice.i18n';

	interface MemberOption {
		key: string;
		label: string;
	}

	let {
		block,
		members = [],
		hasMedicalInput = false,
		disabled = false,
		confirm = 'embedded',
		size = 'default',
		onbasic,
		onconfirm
	}: {
		block: ConsentBlockState;
		/** C4 candidates: members other than the registrant who still need consent (FR-13). */
		members?: MemberOption[];
		hasMedicalInput?: boolean;
		disabled?: boolean;
		/** 'embedded': the host form's submit is「ยืนยัน」(FR-19). 'standalone': the block renders it. */
		confirm?: 'embedded' | 'standalone';
		/** 'kiosk': touch-sized controls and text; the kiosk-portrait/kiosk-compact variants only apply here. */
		size?: 'default' | 'kiosk';
		/** Embedded「ลงทะเบียนแบบพื้นฐาน」: the host re-runs its submit in basic mode. */
		onbasic?: () => void;
		/** Standalone: called with the decision once confirmed. */
		onconfirm?: (decision: ConsentDecision) => void;
	} = $props();

	const uid = $props.id();

	const sizes = {
		default: {
			section: 'space-y-3 p-4 sm:p-6',
			heading: 'text-lg sm:text-xl',
			option: 'min-h-12',
			optionText: 'text-sm sm:text-base',
			checkbox: 'size-5',
			tag: 'text-xs',
			noticeTitle: 'text-base',
			noticeBody: 'text-sm sm:text-base',
			button: 'min-h-12'
		},
		kiosk: {
			section:
				'space-y-3 p-4 kiosk-portrait:space-y-5 kiosk-portrait:p-8 kiosk-compact:space-y-2 kiosk-compact:p-3',
			heading: 'text-xl kiosk-portrait:text-3xl kiosk-compact:text-lg',
			option: 'min-h-14 kiosk-portrait:min-h-20 kiosk-compact:min-h-11',
			optionText: 'text-base kiosk-portrait:text-2xl kiosk-compact:text-sm',
			checkbox: 'size-6 kiosk-portrait:size-9 kiosk-compact:size-5',
			tag: 'text-sm kiosk-portrait:text-lg kiosk-compact:text-xs',
			noticeTitle: 'text-lg kiosk-portrait:text-2xl kiosk-compact:text-base',
			noticeBody: 'text-base kiosk-portrait:text-xl kiosk-compact:text-sm',
			button:
				'h-auto min-h-14 w-full whitespace-normal py-3 text-lg sm:flex-1 kiosk-portrait:min-h-20 kiosk-portrait:text-2xl kiosk-compact:min-h-12 kiosk-compact:text-base'
		}
	} as const;
	const sz = $derived(sizes[size]);

	const memberKeys = $derived(members.map((m) => m.key));
	const needsGuardianPick = $derived(!block.canConfirm(memberKeys));
	const showGuardian = $derived(block.caps.guardian && members.length > 0);

	function confirmStandalone() {
		const gate = block.confirm(memberKeys);
		if (gate.kind === 'decided') onconfirm?.(gate.decision);
	}

	function confirmBasic() {
		if (confirm === 'embedded') {
			onbasic?.();
			return;
		}
		const gate = block.confirmBasic(memberKeys);
		if (gate.kind === 'decided') onconfirm?.(gate.decision);
	}

	function backToChoosing() {
		block.backToChoosing();
		document.getElementById(`${uid}-main`)?.focus();
	}

	function focusOnMount(el: HTMLElement) {
		el.focus();
	}
</script>

{#snippet tag(text: string, tone: 'main' | 'sensitive' | 'optional')}
	<span
		class={[
			'me-2 mb-1 inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold',
			sz.tag,
			tone === 'main' &&
				'border-domain-registration-border bg-domain-registration-subtle text-domain-registration-text',
			tone === 'sensitive' && 'border-amber-200 bg-amber-50 text-amber-900',
			tone === 'optional' && 'border-slate-200 bg-slate-100 text-slate-700'
		]}>{text}</span
	>
{/snippet}

{#snippet option(
	id: string,
	checked: boolean,
	onchange: (value: boolean) => void,
	tagText: string,
	tone: 'main' | 'sensitive' | 'optional',
	text: string
)}
	<label
		for={id}
		class={[
			'flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 transition-colors hover:border-domain-registration-border has-[[data-state=checked]]:border-domain-registration-border has-[[data-state=checked]]:bg-domain-registration-subtle/40',
			sz.option
		]}
	>
		<Checkbox
			{id}
			{checked}
			{disabled}
			onCheckedChange={(value) => onchange(value === true)}
			class={[
				'mt-0.5 shrink-0 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2',
				sz.checkbox
			]}
		/>
		<span class={['leading-relaxed text-slate-700', sz.optionText]}>
			{@render tag(tagText, tone)}{text}
		</span>
	</label>
{/snippet}

<section
	aria-labelledby="{uid}-heading"
	class={['rounded-2xl border border-slate-200/80 bg-white shadow-2xs', sz.section]}
>
	<h3 id="{uid}-heading" class={['flex items-center gap-2 font-bold text-slate-900', sz.heading]}>
		<ShieldCheck class="size-5 text-domain-registration" aria-hidden="true" />
		{copy.heading}
	</h3>

	{@render option(
		`${uid}-main`,
		block.full,
		(value) => (block.full = value),
		copy.main.tag,
		'main',
		copy.main.text
	)}

	{@render option(
		`${uid}-health`,
		block.health,
		(value) => (block.health = value),
		copy.health.tag,
		'sensitive',
		copy.health.text
	)}

	{@render option(
		`${uid}-search`,
		block.searchVisible,
		(value) => (block.searchVisible = value),
		copy.search.tag,
		'optional',
		copy.search.text
	)}

	{#if showGuardian}
		<div class="space-y-2">
			{@render option(
				`${uid}-guardian`,
				block.guardian,
				(value) => (block.guardian = value),
				copy.guardian.tag,
				'optional',
				copy.guardian.text
			)}
			{#if block.guardian}
				<fieldset
					class="ms-8 space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3"
					aria-describedby={needsGuardianPick ? `${uid}-guardian-need` : undefined}
				>
					<legend class="px-1 text-sm font-semibold text-slate-700">
						{copy.guardian.membersLabel}
					</legend>
					{#each members as member (member.key)}
						<label
							for="{uid}-ward-{member.key}"
							class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white px-3 py-2"
						>
							<Checkbox
								id="{uid}-ward-{member.key}"
								checked={block.guardianKeys.includes(member.key)}
								{disabled}
								onCheckedChange={(value) => block.setGuardianPick(member.key, value === true)}
								class="size-5 shrink-0 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
							/>
							<span class="text-sm text-slate-800 sm:text-base">{member.label}</span>
						</label>
					{/each}
					{#if needsGuardianPick}
						<p id="{uid}-guardian-need" class="text-sm font-semibold text-red-700">
							{copy.guardian.needOne}
						</p>
					{/if}
				</fieldset>
			{/if}
		</div>
	{/if}

	{#if block.showsVerbal && block.staff}
		<div class="space-y-2 rounded-xl border border-dashed border-slate-300 p-2">
			{@render option(
				`${uid}-verbal`,
				block.verbal,
				(value) => (block.verbal = value),
				copy.verbal.tag,
				'optional',
				copy.verbal.text
			)}
			{#if block.verbal}
				<p class="ms-8 text-sm text-slate-700">
					<span class="font-semibold">{copy.verbal.staffLabel}:</span>
					{block.staff.name} <span class="tabular-nums">({block.staff.userId})</span>
				</p>
			{/if}
		</div>
	{/if}

	{#if block.discardsMedical(hasMedicalInput)}
		<p
			class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900"
		>
			<TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{copy.healthDiscardWarning}
		</p>
	{/if}

	{#if block.noticeVisible}
		<div role="alert" class="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
			<p class={['font-bold text-amber-900', sz.noticeTitle]}>{copy.basicNotice.title}</p>
			<p class={['leading-relaxed text-amber-900', sz.noticeBody]}>{copy.basicNotice.body}</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<Button
					class={[
						'bg-domain-registration-strong text-white hover:bg-domain-registration-text',
						sz.button
					]}
					{disabled}
					onclick={confirmBasic}
					{@attach focusOnMount}
				>
					{copy.basicNotice.confirmBasic}
				</Button>
				<Button variant="outline" class={sz.button} {disabled} onclick={backToChoosing}>
					{copy.basicNotice.backToEdit}
				</Button>
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-2 sm:flex-row">
			{#if confirm === 'standalone'}
				<Button
					class={[
						'bg-domain-registration-strong text-white hover:bg-domain-registration-text',
						sz.button
					]}
					disabled={disabled || needsGuardianPick}
					onclick={confirmStandalone}
				>
					{copy.actions.confirm}
				</Button>
			{/if}
			<Button variant="outline" class={sz.button} {disabled} onclick={() => block.decline()}>
				{copy.actions.decline}
			</Button>
		</div>
	{/if}
</section>
