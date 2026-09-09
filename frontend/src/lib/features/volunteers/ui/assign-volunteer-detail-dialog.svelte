<script lang="ts">
	/** Focused read view for one assign-roster candidate. */
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Clock3 from '@lucide/svelte/icons/clock-3';
	import IdCard from '@lucide/svelte/icons/id-card';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Tag from '@lucide/svelte/icons/tag';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { AssignCandidate } from '../domain/assign-roster';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';

	let {
		open = $bindable(false),
		candidate,
		shelterLabel,
		skillOptions = [],
		pending = false,
		onassign
	}: {
		open?: boolean;
		candidate: AssignCandidate | null;
		shelterLabel: string;
		skillOptions?: readonly SkillOption[];
		pending?: boolean;
		onassign: (candidate: AssignCandidate) => void | Promise<void>;
	} = $props();

	const volunteer = $derived(candidate?.volunteer ?? null);
	const fullName = $derived(
		volunteer ? `${volunteer.first_name} ${volunteer.last_name}` : 'รายละเอียดอาสาสมัคร'
	);
	const skills = $derived.by<SkillOption[]>(() => {
		if (!volunteer) return [];
		const uniqueSkills: SkillOption[] = [];
		for (const value of volunteer.skills) {
			const option = resolveSkillOption(value, skillOptions);
			if (option && !uniqueSkills.some((skill) => skill.code === option.code)) {
				uniqueSkills.push(option);
			}
		}
		return uniqueSkills;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-xl">
		<div class="border-b border-border bg-muted/30 px-6 py-5">
			<Dialog.Title class="flex items-start gap-3 text-lg font-bold">
				<span
					class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"
				>
					<IdCard class="h-5 w-5" />
				</span>
				<span class="min-w-0">
					<span class="block truncate">{fullName}</span>
					{#if volunteer}
						<span class="mt-1 block text-xs font-normal text-muted-foreground">
							รหัสอาสา {volunteer.volunteer_code}
						</span>
					{/if}
				</span>
			</Dialog.Title>
		</div>

		{#if candidate && volunteer}
			<div class="space-y-4 overflow-y-auto px-6 py-5">
				<div class="flex flex-wrap items-center gap-2">
					{#if volunteer.identity_verified}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"
						>
							<BadgeCheck class="h-3.5 w-3.5" />
							ยืนยันตัวตนแล้ว
						</span>
					{:else}
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200"
						>
							<Clock3 class="h-3.5 w-3.5" />
							รอยืนยันตัวตน
						</span>
					{/if}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground"
					>
						<BriefcaseBusiness class="h-3.5 w-3.5" />
						{volunteer.personnel_type === 'staff' ? 'เจ้าหน้าที่' : 'อาสาสมัคร'}
					</span>
				</div>

				<div class="rounded-xl border border-border bg-card p-4">
					<div class="flex items-center justify-between gap-3">
						<h3 class="text-sm font-bold">สถานะในกะนี้</h3>
						{#if candidate.state.kind === 'available'}
							<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
								<CircleCheck class="h-3.5 w-3.5" /> ว่างในกะนี้
							</span>
						{:else if candidate.state.kind === 'accepted'}
							<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
								<CircleCheck class="h-3.5 w-3.5" /> อยู่ในกะนี้แล้ว
							</span>
						{:else}
							<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
								<TriangleAlert class="h-3.5 w-3.5" /> เวลาชนกะอื่น
							</span>
						{/if}
					</div>
					{#if candidate.state.kind === 'collision'}
						<p class="mt-2 text-xs text-rose-700">
							{candidate.state.jobTitle} · {candidate.state.startTime}–{candidate.state.endTime} น.
						</p>
					{/if}
				</div>

				<div class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
					<div class="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
						<Phone class="h-4 w-4 shrink-0 text-primary" />
						<span class="truncate">{volunteer.phone ?? 'ไม่ระบุเบอร์โทร'}</span>
					</div>
					<div class="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
						<MapPin class="h-4 w-4 shrink-0 text-primary" />
						<span class="truncate">{shelterLabel}</span>
					</div>
					{#if volunteer.organization}
						<div
							class="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 sm:col-span-2"
						>
							<BriefcaseBusiness class="h-4 w-4 shrink-0 text-primary" />
							<span class="truncate">{volunteer.organization}</span>
						</div>
					{/if}
				</div>

				<div>
					<h3 class="inline-flex items-center gap-1.5 text-sm font-bold">
						<Tag class="h-4 w-4 text-primary" /> ทักษะ
					</h3>
					{#if skills.length > 0}
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each skills as skill (skill.code)}
								<span class="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
									{skill.label}
								</span>
							{/each}
						</div>
					{:else}
						<p class="mt-2 text-xs text-muted-foreground">ยังไม่มีข้อมูลทักษะ</p>
					{/if}
				</div>

				{#if !volunteer.identity_verified}
					<p
						class="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200"
					>
						<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0" />
						สถานะนี้เป็นข้อมูลประกอบการมอบหมาย กรุณาตรวจสอบเอกสารตามขั้นตอนของศูนย์ก่อนให้เข้าปฏิบัติงาน
					</p>
				{/if}
			</div>

			<div
				class="flex flex-col-reverse gap-2 border-t border-border px-6 py-3 sm:flex-row sm:justify-end"
			>
				<Button variant="outline" onclick={() => (open = false)}>ปิด</Button>
				{#if candidate.assignable}
					<Button disabled={pending} onclick={() => onassign(candidate)} class="gap-1.5">
						<UserPlus class="h-4 w-4" />
						{pending ? 'กำลังมอบหมาย...' : 'มอบหมายอาสาคนนี้'}
					</Button>
				{:else}
					<Button variant="secondary" disabled>ยังมอบหมายไม่ได้</Button>
				{/if}
			</div>
		{:else}
			<div class="px-6 py-10 text-center text-sm text-muted-foreground">ไม่พบข้อมูลอาสาสมัคร</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
