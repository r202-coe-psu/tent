<script lang="ts">
	import type { Rule } from '../domain/schema';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { toast } from 'svelte-sonner';

	let {
		rules = $bindable([])
	}: {
		rules: Rule[];
	} = $props();

	let ruleFormId = $state('');
	let ruleFormName = $state('');
	let ruleFormDescription = $state('');
	let ruleEditingIndex = $state<number | null>(null);

	function saveRule() {
		if (!ruleFormId.trim() || !ruleFormName.trim() || !ruleFormDescription.trim()) {
			toast.error('กรุณากรอกข้อมูลเกณฑ์คัดแยกให้ครบถ้วน');
			return;
		}
		const newRule: Rule = {
			rule_id: ruleFormId.trim(),
			name: ruleFormName.trim(),
			description: ruleFormDescription.trim()
		};
		if (ruleEditingIndex !== null) {
			rules[ruleEditingIndex] = newRule;
			ruleEditingIndex = null;
			toast.success('แก้ไขกฎคัดกรองสำเร็จ');
		} else {
			if (rules.some((r) => r.rule_id === newRule.rule_id)) {
				toast.error('รหัสกฎนี้มีอยู่แล้ว');
				return;
			}
			rules.push(newRule);
			toast.success('เพิ่มกฎคัดกรองสำเร็จ');
		}
		clearRuleForm();
	}

	function editRule(index: number) {
		const r = rules[index];
		ruleFormId = r.rule_id;
		ruleFormName = r.name;
		ruleFormDescription = r.description;
		ruleEditingIndex = index;
	}

	function deleteRule(index: number) {
		rules.splice(index, 1);
		toast.success('ลบกฎคัดกรองสำเร็จ');
	}

	function clearRuleForm() {
		ruleFormId = '';
		ruleFormName = '';
		ruleFormDescription = '';
		ruleEditingIndex = null;
	}
</script>

<section class="mb-6 space-y-6 rounded-2xl border border-shelter-border bg-card p-6 shadow-sm">
	<div class="flex items-center space-x-2 border-b border-shelter-border pb-3">
		<span
			class="flex h-6 w-6 items-center justify-center rounded-full bg-shelter-emerald-bg text-xs font-bold text-shelter-emerald-text"
			>4</span
		>
		<h2 class="text-base font-bold text-card-foreground">
			เกณฑ์การคัดกรองและกฎคัดแยก (Criteria & Rules)
		</h2>
	</div>

	<!-- Table View -->
	<div class="overflow-x-auto rounded-xl border border-shelter-border">
		<table class="w-full border-collapse text-left">
			<thead>
				<tr
					class="border-b border-shelter-border bg-muted/50 text-xs font-bold text-muted-foreground"
				>
					<th class="px-4 py-3">รหัสกฎ (Rule ID)</th>
					<th class="px-4 py-3">ชื่อเงื่อนไข/กฎคัดกรอง</th>
					<th class="px-4 py-3">คำอธิบายรายละเอียดเงื่อนไข</th>
					<th class="w-28 px-4 py-3 text-center">จัดการ</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-shelter-border text-xs text-foreground">
				{#if rules.length === 0}
					<tr>
						<td colspan="4" class="px-4 py-8 text-center text-muted-foreground"
							>ยังไม่มีข้อมูลเกณฑ์กฎคัดกรอง</td
						>
					</tr>
				{:else}
					{#each rules as rule, index (rule.rule_id)}
						<tr class="hover:bg-muted/20">
							<td class="px-4 py-3 font-mono text-shelter-emerald-text">{rule.rule_id}</td>
							<td class="px-4 py-3 font-bold text-foreground">{rule.name}</td>
							<td class="px-4 py-3 text-muted-foreground">{rule.description}</td>
							<td class="space-x-2 px-4 py-3 text-center">
								<button
									type="button"
									onclick={() => editRule(index)}
									class="text-muted-foreground hover:text-foreground"
									title="แก้ไข"
								>
									<Pencil class="inline h-4 w-4" />
								</button>
								<button
									type="button"
									onclick={() => deleteRule(index)}
									class="text-destructive hover:text-destructive/80"
									title="ลบ"
								>
									<Trash2 class="inline h-4 w-4" />
								</button>
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Form View -->
	<div class="space-y-4 rounded-xl border border-shelter-border bg-shelter-bg p-5">
		<h3
			class="flex items-center space-x-1 text-xs font-bold tracking-wider text-muted-foreground uppercase"
		>
			<Plus class="h-3.5 w-3.5 text-muted-foreground" />
			<span>ฟอร์มเพิ่ม/แก้ไข เกณฑ์และกฎคัดกรอง</span>
		</h3>
		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div>
				<label for="rule-id-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>รหัสกฎ (Rule ID) *</label
				>
				<Input
					id="rule-id-input"
					type="text"
					bind:value={ruleFormId}
					placeholder="เช่น rule-vulnerable"
				/>
			</div>
			<div>
				<label for="rule-name-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>ชื่อเงื่อนไข / กฎคัดกรอง *</label
				>
				<Input
					id="rule-name-input"
					type="text"
					bind:value={ruleFormName}
					placeholder="เช่น กลุ่มเปราะบางอัตโนมัติ"
				/>
			</div>
			<div>
				<label for="rule-desc-input" class="mb-1 block text-xs font-bold text-muted-foreground"
					>คำอธิบายรายละเอียดเงื่อนไข *</label
				>
				<Input
					id="rule-desc-input"
					type="text"
					bind:value={ruleFormDescription}
					placeholder="เช่น อายุตั้งแต่ 60 ปีขึ้นไป หรือเป็นผู้พิการ"
				/>
			</div>
		</div>
		<div class="flex justify-end space-x-2">
			<Button type="button" variant="outline" onclick={clearRuleForm}>
				<RotateCcw class="h-3.5 w-3.5" />
				ล้างค่า
			</Button>
			<Button type="button" onclick={saveRule}>
				<Plus class="h-3.5 w-3.5" />
				บันทึกกฎคัดกรอง
			</Button>
		</div>
	</div>
</section>
