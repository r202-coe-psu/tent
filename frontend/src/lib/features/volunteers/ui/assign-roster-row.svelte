<script lang="ts">
	/**
	 * One candidate row of the "มอบหมายอาสาเข้ากะ" roster (approved mockup
	 * 2026-08-28).
	 *
	 * Purely presentational: the row's state — available / accepted / collision
	 * — is decided by `domain/assign-roster.ts` and passed in. This component
	 * never inspects assignments or duty windows itself.
	 */
	import Phone from '@lucide/svelte/icons/phone';
	import IdCard from '@lucide/svelte/icons/id-card';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import UserRound from '@lucide/svelte/icons/user-round';
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import Clock from '@lucide/svelte/icons/clock';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import type { AssignCandidate } from '../domain/assign-roster';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';

	let {
		candidate,
		shelterLabel,
		skillOptions = [],
		selected,
		onToggle
	}: {
		candidate: AssignCandidate;
		/** Resolved shelter name for this volunteer's posting, or its code. */
		shelterLabel: string;
		/** Effective Master Data skills for rendering labels instead of stored ids. */
		skillOptions?: readonly SkillOption[];
		selected: boolean;
		onToggle: (volunteerId: string, next: boolean) => void;
	} = $props();

	const v = $derived(candidate.volunteer);
	const fullName = $derived(`${v.first_name} ${v.last_name}`);
	const rowId = $derived(`assign-row-${v._id}`);
	const skills = $derived(
		v.skills.flatMap((value) => {
			const option = resolveSkillOption(value, skillOptions);
			return option ? [option] : [];
		})
	);
</script>

<li
	class={[
		'rounded-2xl border p-3.5 transition-colors',
		candidate.assignable
			? 'border-border bg-card hover:border-primary/40'
			: 'border-border/60 bg-muted/40'
	]}
>
	<div class="flex items-start gap-3">
		<Checkbox
			id={rowId}
			checked={selected}
			disabled={!candidate.assignable}
			aria-label={`เลือก ${fullName}`}
			onCheckedChange={(next) => onToggle(v._id, next === true)}
			class="mt-1 shrink-0"
		/>

		<div class="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
			<div class="min-w-0 space-y-1.5">
				<div class="flex flex-wrap items-center gap-2">
					<label for={rowId} class="cursor-pointer text-sm font-bold break-words text-foreground">
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
						อาสาสมัคร
					</span>
				</div>

				<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span class="inline-flex items-center gap-1.5">
						<Phone class="h-3.5 w-3.5" />
						{v.phone ?? '—'}
					</span>
					<span class="inline-flex items-center gap-1.5">
						<IdCard class="h-3.5 w-3.5" />
						รหัสอาสา: <span class="font-mono font-bold text-foreground">{v.volunteer_code}</span>
					</span>
					<span class="inline-flex min-w-0 items-center gap-1.5">
						<MapPin class="h-3.5 w-3.5 shrink-0" />
						<span class="truncate">ศูนย์: {shelterLabel}</span>
					</span>
				</div>

				{#if skills.length > 0}
					<div class="flex flex-wrap items-center gap-1.5">
						<span class="text-[11px] text-muted-foreground">ทักษะ:</span>
						{#each skills as skill (skill.code)}
							<span
								class="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
							>
								{skill.label}
							</span>
						{/each}
					</div>
				{/if}
			</div>

			<div class="shrink-0 lg:pl-3">
				{#if candidate.state.kind === 'collision'}
					{@const clash = candidate.state}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700 ring-1 ring-rose-200"
					>
						<TriangleAlert class="h-3.5 w-3.5 shrink-0" />
						เวลาชนกับกะอื่น ({clash.jobTitle}: {clash.startTime}-{clash.endTime} น.)
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
			</div>
		</div>
	</div>
</li>
