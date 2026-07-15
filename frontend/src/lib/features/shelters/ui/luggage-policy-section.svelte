<script lang="ts">
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, LuggageRule } from '../domain/schema';
	import { luggageRuleLabels } from '../domain/policy-labels';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	let {
		formData,
		disabled = false
	}: {
		formData: SuperFormData<Shelter>;
		disabled?: boolean;
	} = $props();

	const luggageRules: { value: LuggageRule; label: string }[] = Object.entries(
		luggageRuleLabels
	).map(([value, label]) => ({ value: value as LuggageRule, label }));

	function ensurePolicy() {
		if (!$formData.luggage_policy) {
			$formData.luggage_policy = {
				limitation: null,
				max_per_family: null,
				rules: [],
				rules_other: null
			};
		}
	}

	function setLimitation(value: 'no_limit' | 'limited') {
		ensurePolicy();
		$formData.luggage_policy!.limitation = value;
		// FR-23-26 — clear the count when no longer limited.
		if (value !== 'limited') $formData.luggage_policy!.max_per_family = null;
	}

	function toggleRule(rule: LuggageRule, checked: boolean) {
		ensurePolicy();
		const cur = $formData.luggage_policy!.rules ?? [];
		$formData.luggage_policy!.rules = checked
			? [...new Set([...cur, rule])]
			: cur.filter((r) => r !== rule);
	}

	const limitation = $derived($formData.luggage_policy?.limitation ?? null);
</script>

<section class="mt-6 mb-6 space-y-6 rounded-2xl border border-shelter-border p-6">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<Briefcase class="h-5 w-5 text-shelter-blue-text" />
		<span class="text-sm font-bold text-muted-foreground">7.</span>
		<h2 class="text-base font-bold text-card-foreground">
			นโยบายทรัพย์สินมีค่า / สัมภาระ (Valuables &amp; Luggage Policy)
		</h2>
	</div>

	<!-- 7.1 Luggage limitation -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-card-foreground">
			1. ข้อกำหนดเรื่องปริมาณสัมภาระ (Luggage Limitation)
		</h3>
		<div class="space-y-2 rounded-lg border border-shelter-border bg-background p-3">
			<label class="flex items-center space-x-3 text-sm">
				<input
					type="radio"
					name="luggage-limitation"
					value="no_limit"
					checked={limitation === 'no_limit'}
					onchange={() => setLimitation('no_limit')}
					{disabled}
					class="h-4 w-4 accent-shelter-blue-text"
				/>
				<span>ไม่จำกัดปริมาณสัมภาระ (No Limits)</span>
			</label>
			<label class="flex items-center space-x-3 text-sm">
				<input
					type="radio"
					name="luggage-limitation"
					value="limited"
					checked={limitation === 'limited'}
					onchange={() => setLimitation('limited')}
					{disabled}
					class="h-4 w-4 accent-shelter-blue-text"
				/>
				<span>จำกัดปริมาณสัมภาระพื้นที่จำกัด (Limited Luggage)</span>
			</label>

			{#if limitation === 'limited'}
				<div class="flex items-center gap-2 pt-2 pl-7 text-sm">
					<span class="text-muted-foreground">จำกัดไม่เกิน</span>
					<Input
						type="number"
						min="0"
						value={$formData.luggage_policy?.max_per_family ?? ''}
						oninput={(e) => {
							ensurePolicy();
							$formData.luggage_policy!.max_per_family =
								e.currentTarget.value === '' ? null : Number(e.currentTarget.value);
						}}
						{disabled}
						class="w-24"
						placeholder="0"
					/>
					<span class="text-muted-foreground">ชิ้น/กระเป๋า ต่อ 1 ครอบครัว</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- 7.2 Standard disclaimers -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-card-foreground">
			2. เงื่อนไขและข้อปฏิบัติด้านทรัพย์สิน (Standard Disclaimers &amp; Rules)
		</h3>
		<div class="space-y-2 rounded-lg border border-shelter-border bg-background p-3">
			{#each luggageRules as rule (rule.value)}
				<label class="flex items-start space-x-2 text-sm">
					<Checkbox
						checked={($formData.luggage_policy?.rules ?? []).includes(rule.value)}
						onCheckedChange={(v) => toggleRule(rule.value, v === true)}
						{disabled}
					/>
					<span>{rule.label}</span>
				</label>
			{/each}
			<div class="flex items-center gap-2 pt-1">
				<span class="shrink-0 text-sm text-muted-foreground">อื่นๆ (โปรดระบุ):</span>
				<Input
					value={$formData.luggage_policy?.rules_other ?? ''}
					oninput={(e) => {
						ensurePolicy();
						$formData.luggage_policy!.rules_other = e.currentTarget.value || null;
					}}
					{disabled}
					class="flex-1"
				/>
			</div>
		</div>
	</div>
</section>
