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

<!--
	Laid out by the row's own width (container query), not the viewport: the roster sits
	inside the assign page's content column, so viewport breakpoints split name and
	actions side by side while the row is still narrow — the name squeezed to a word per
	line under the buttons. Narrow: name, badges and skills stack, then the state, then
	full-width actions. Wide: details on the left, state and actions on the right.
-->
<li
	class={[
		'@container rounded-2xl border p-3 transition-colors sm:p-4',
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
			class="mt-1 size-5 shrink-0"
		/>

		<div
			class="flex min-w-0 flex-1 flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-6"
		>
			<div class="min-w-0 space-y-2">
				<label
					for={rowId}
					class="block cursor-pointer text-base font-bold break-words text-foreground"
				>
					{fullName}
				</label>

				<div class="flex flex-wrap items-center gap-1.5">
					{#if v.identity_verified}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-emerald-700 ring-1 ring-emerald-200"
						>
							<BadgeCheck class="size-3.5 shrink-0" />
							ยืนยันตัวตนแล้ว
						</span>
					{:else}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 ring-1 ring-amber-200"
						>
							<Clock class="size-3.5 shrink-0" />
							รอยืนยันตัวตน
						</span>
					{/if}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-foreground"
					>
						<UserRound class="size-3.5 shrink-0" />
						{v.personnel_type === 'staff' ? 'เจ้าหน้าที่' : 'อาสาสมัคร'}
					</span>
				</div>

				{#if skills.length > 0}
					<div class="flex min-w-0 flex-wrap items-center gap-1.5">
						<Tag class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
						<span class="sr-only">ทักษะ:</span>
						{#each skills.slice(0, 2) as skill (skill.code)}
							<span class="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
								{skill.label}
							</span>
						{/each}
						{#if skills.length > 2}
							<span class="text-xs font-medium text-muted-foreground">
								+{skills.length - 2}
							</span>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-2 @2xl:shrink-0 @2xl:items-end">
				{#if candidate.state.kind === 'collision'}
					{@const clash = candidate.state}
					<span
						class="inline-flex items-start gap-1.5 self-start rounded-xl bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 @2xl:max-w-xs @2xl:self-end"
					>
						<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
						<span>
							เวลาชนกับ “{clash.jobTitle}” ·
							<span class="whitespace-nowrap tabular-nums"
								>{clash.startTime}–{clash.endTime} น.</span
							>
						</span>
					</span>
				{:else if candidate.state.kind === 'accepted'}
					<span
						class="inline-flex items-center gap-1.5 self-start rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 @2xl:self-end"
					>
						<CircleCheck class="size-3.5 shrink-0" />
						ยืนยันเข้าร่วมกะนี้แล้ว
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1.5 self-start rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 @2xl:self-end"
					>
						<span class="size-1.5 shrink-0 rounded-full bg-emerald-500"></span>
						ว่างในกะนี้ (พร้อมปฏิบัติงาน)
					</span>
				{/if}

				<div class="flex flex-wrap gap-2">
					<Button
						variant="outline"
						class="min-h-11 flex-auto gap-1.5 text-sm sm:min-h-9 @md:flex-none"
						onclick={() => onDetails(candidate)}
					>
						<Eye class="size-4" />
						ดูรายละเอียด
					</Button>
					{#if candidate.assignable}
						<Button
							class="min-h-11 flex-auto gap-1.5 text-sm sm:min-h-9 @md:flex-none"
							disabled={!capacityAvailable}
							onclick={() => onAssign(candidate)}
						>
							<UserPlus class="size-4" />
							{capacityAvailable ? 'มอบหมาย' : 'กะเต็มแล้ว'}
						</Button>
					{/if}
				</div>
			</div>
		</div>
	</div>
</li>
