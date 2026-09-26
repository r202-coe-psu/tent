<script lang="ts">
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { Shelter, LuggageRule } from '../domain/schema';
	import { luggageRuleLabels } from '../domain/policy-labels';
	import { applyLuggageLimitation } from '../domain/feature-flag-policy-sync';
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
		const next = applyLuggageLimitation($formData, value);
		$formData.feature_flags = next.feature_flags;
		$formData.luggage_policy = next.luggage_policy;
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

<section
	id="luggage-policy"
	class="shelter-form-scroll-mt mb-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs transition-shadow hover:shadow-sm sm:p-8"
>
	<div class="flex items-center gap-3 border-b border-slate-100 pb-4">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0A2647]/5 text-[#0A2647]"
		>
			<Briefcase class="h-5 w-5" />
		</div>
		<div>
			<div class="flex items-center gap-2">
				<span class="text-xs font-bold tracking-wider text-[#0284C7] uppercase">ส่วนที่ 8</span>
			</div>
			<h2 class="text-base font-bold text-[#0A2647] sm:text-lg">
				นโยบายทรัพย์สินมีค่า / สัมภาระ (Valuables &amp; Luggage Policy)
			</h2>
		</div>
	</div>

	<!-- 7.1 Luggage limitation -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-slate-800">
			1. ข้อกำหนดเรื่องปริมาณสัมภาระ (Luggage Limitation)
		</h3>
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
			<label class="flex cursor-pointer items-center space-x-3 text-sm font-medium text-slate-800">
				<input
					type="radio"
					name="luggage-limitation"
					value="no_limit"
					checked={limitation === 'no_limit'}
					onchange={() => setLimitation('no_limit')}
					{disabled}
					class="h-4 w-4 accent-[#0A2647]"
				/>
				<span>ไม่จำกัดปริมาณสัมภาระ (No Limits)</span>
			</label>
			<label class="flex cursor-pointer items-center space-x-3 text-sm font-medium text-slate-800">
				<input
					type="radio"
					name="luggage-limitation"
					value="limited"
					checked={limitation === 'limited'}
					onchange={() => setLimitation('limited')}
					{disabled}
					class="h-4 w-4 accent-[#0A2647]"
				/>
				<span>จำกัดปริมาณสัมภาระพื้นที่จำกัด (Limited Luggage)</span>
			</label>

			{#if limitation === 'limited'}
				<div class="flex items-center gap-2 pt-2 pl-7 text-sm">
					<span class="text-slate-500">จำกัดไม่เกิน</span>
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
						class="w-24 bg-white"
						placeholder="0"
					/>
					<span class="text-slate-500">ชิ้น/กระเป๋า ต่อ 1 ครอบครัว</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- 7.2 Standard disclaimers -->
	<div class="space-y-3">
		<h3 class="text-sm font-bold text-slate-800">
			2. เงื่อนไขและข้อปฏิบัติด้านทรัพย์สิน (Standard Disclaimers &amp; Rules)
		</h3>
		<div class="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 shadow-2xs">
			{#each luggageRules as rule (rule.value)}
				<label class="flex cursor-pointer items-start space-x-3 text-sm font-medium text-slate-800">
					<Checkbox
						checked={($formData.luggage_policy?.rules ?? []).includes(rule.value)}
						onCheckedChange={(v) => toggleRule(rule.value, v === true)}
						{disabled}
					/>
					<span>{rule.label}</span>
				</label>
			{/each}
			<div class="flex items-center gap-2 pt-1">
				<span class="shrink-0 text-sm font-medium text-slate-600">อื่นๆ (โปรดระบุ):</span>
				<Input
					value={$formData.luggage_policy?.rules_other ?? ''}
					oninput={(e) => {
						ensurePolicy();
						$formData.luggage_policy!.rules_other = e.currentTarget.value || null;
					}}
					{disabled}
					class="flex-1 bg-white"
				/>
			</div>
		</div>
	</div>
</section>
