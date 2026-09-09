<script lang="ts">
	/**
	 * One candidate row of the "มอบหมายอาสาเข้ากะ" roster (approved mockup
	 * 2026-08-28).
	 *
	 * Purely presentational: the row's state — available / accepted / collision
	 * — is decided by `domain/assign-roster.ts` and passed in. This component
	 * never inspects assignments or duty windows itself.
	 */
	import Eye from '@lucide/svelte/icons/eye';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Tag from '@lucide/svelte/icons/tag';
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import Clock from '@lucide/svelte/icons/clock';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	import type { AssignCandidate } from '../domain/assign-roster';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';

	let {
		candidate,
		skillOptions = [],
		selected,
		capacityAvailable,
		onToggle,
		onDetails,
		onAssign
	}: {
		candidate: AssignCandidate;
		/** Effective Master Data skills for rendering labels instead of stored ids. */
		skillOptions?: readonly SkillOption[];
		selected: boolean;
		capacityAvailable: boolean;
		onToggle: (volunteerId: string, next: boolean) => void;
		onDetails: (candidate: AssignCandidate) => void;
		onAssign: (candidate: AssignCandidate) => void | Promise<void>;
	} = $props();

	const v = $derived(candidate.volunteer);
	const fullName = $derived(`${v.first_name} ${v.last_name}`);
	const rowId = $derived(`assign-row-${v._id}`);
	const skills = $derived.by<SkillOption[]>(() => {
		// This map is a local deduplication buffer and is not exposed to the template.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, SkillOption>();
		for (const value of v.skills) {
			const option = resolveSkillOption(value, skillOptions);
			if (option && !map.has(option.code)) {
				map.set(option.code, option);
			}
		}
		return Array.from(map.values());
	});
</script>

<li
	class={[
		'rounded-2xl border p-3 transition-colors sm:p-3.5',
		candidate.assignable
			? 'border-border bg-card hover:border-primary/40'
			: 'border-border/60 bg-muted/40'
	]}
>
	<div class="flex items-start gap-3">
		<Checkbox
			id={rowId}
			checked={selected}
			disabled={!candidate.assignable || !capacityAvailable}
			aria-label={`เลือก ${fullName}`}
			onCheckedChange={(next) => onToggle(v._id, next === true)}
			class="mt-1 shrink-0"
		/>

		<div class="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
			<div class="min-w-0 space-y-1.5">
				<div class="flex flex-wrap items-center gap-2">
					<label
						for={rowId}
						class="cursor-pointer text-sm font-bold break-words text-foreground sm:text-base"
					>
						{fullName}
					</label>
					{#if v.identity_verified}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
						>
							<BadgeCheck class="h-3 w-3" />
							ยืนยันตัวตนแล้ว
						</span>
					{:else}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
						>
							<Clock class="h-3 w-3" />
							รอยืนยันตัวตน
						</span>
					{/if}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
					>
						<UserRound class="h-3 w-3" />
						{v.personnel_type === 'staff' ? 'เจ้าหน้าที่' : 'อาสาสมัคร'}
					</span>
				</div>

				{#if skills.length > 0}
					<div class="flex min-w-0 flex-wrap items-center gap-1.5">
						<Tag class="h-3.5 w-3.5 shrink-0 text-primary" />
						{#each skills.slice(0, 2) as skill (skill.code)}
							<span
								class="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
							>
								{skill.label}
							</span>
						{/each}
						{#if skills.length > 2}
							<span class="text-[11px] font-medium text-muted-foreground">+{skills.length - 2}</span
							>
						{/if}
					</div>
				{/if}
			</div>

			<div
				class="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end lg:pl-4"
			>
				{#if candidate.state.kind === 'collision'}
					{@const clash = candidate.state}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200"
					>
						<TriangleAlert class="h-3.5 w-3.5 shrink-0" />
						เวลาชนกะอื่น · {clash.startTime}-{clash.endTime} น.
					</span>
				{:else if candidate.state.kind === 'accepted'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"
					>
						<CircleCheck class="h-3.5 w-3.5 shrink-0" />
						ยืนยันเข้าร่วมกะนี้แล้ว (Approved)
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-200"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
						ว่างในกะนี้ (พร้อมปฏิบัติงาน)
					</span>
				{/if}
				<div class="flex items-center gap-2 sm:justify-end">
					<Button
						variant="outline"
						size="sm"
						class="h-8 gap-1.5 text-xs"
						onclick={() => onDetails(candidate)}
					>
						<Eye class="h-3.5 w-3.5" />
						ดูรายละเอียด
					</Button>
					{#if candidate.assignable}
						<Button
							size="sm"
							class="h-8 gap-1.5 text-xs"
							disabled={!capacityAvailable}
							onclick={() => onAssign(candidate)}
						>
							<UserPlus class="h-3.5 w-3.5" />
							{capacityAvailable ? 'มอบหมาย' : 'กะเต็มแล้ว'}
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</li>
