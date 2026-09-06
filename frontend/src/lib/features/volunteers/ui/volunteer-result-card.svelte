<script lang="ts">
	/**
	 * On-Site Check-In — scan result panel. Three states: nothing scanned yet
	 * (placeholder), a scanned code that matched no volunteer (`notFoundCode`),
	 * or a matched `volunteer` + their resolved today `assignment` (or none).
	 *
	 * Action gating mirrors `roster-row.svelte`'s identity-verification gate
	 * verbatim (`blockedByIdentity`) so this screen and the SM-facing roster
	 * tab never disagree about when a fresh check-in is allowed. `isEarly` is
	 * this screen's own advisory on top of that — not a new access gate, see
	 * `volunteer-check-in.svelte`'s header comment.
	 */
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Loader from '@lucide/svelte/icons/loader';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Clock from '@lucide/svelte/icons/clock';
	import Lock from '@lucide/svelte/icons/lock';
	import Zap from '@lucide/svelte/icons/zap';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { useSkillOptions } from '../application/queries';
	import { resolveSkillOption, type SkillOption } from '../domain/skill-catalog';
	import type { Volunteer } from '../domain/volunteer.schema';
	import type { ShiftAssignment, ShiftAssignmentStatus } from '../domain/shift-assignment.schema';
	import type { Job } from '../domain/job.schema';

	let {
		volunteer,
		notFoundCode,
		assignment,
		job,
		blockedByIdentity,
		notYetOnShift,
		isEarly,
		earlyByLabel,
		checkInPending,
		checkOutPending,
		oncheckin,
		oncheckout,
		onclear
	}: {
		volunteer: Volunteer | null;
		notFoundCode: string | null;
		assignment: ShiftAssignment | undefined;
		job: Job | undefined;
		blockedByIdentity: boolean;
		notYetOnShift: boolean;
		isEarly: boolean;
		earlyByLabel: string;
		checkInPending: boolean;
		checkOutPending: boolean;
		oncheckin: () => void;
		oncheckout: () => void;
		onclear: () => void;
	} = $props();

	const STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
		assigned: 'รับกะแล้ว',
		standby: 'รอสแตนด์บาย',
		checked_in: 'ปฏิบัติหน้าที่อยู่',
		completed: 'เสร็จสิ้นภารกิจ',
		no_show: 'ขาดปฏิบัติงาน',
		cancelled: 'ยกเลิก'
	};

	function fullName(v: Volunteer): string {
		return `${v.first_name} ${v.last_name}`.trim();
	}

	/** Cosmetic only — not a persisted field. Gives the screen something ticket-shaped to show. */
	function ticketCode(v: Volunteer): string {
		const digits = v._id.replace(/\D/g, '').slice(-6);
		return `TKT-VOL-${digits || v.volunteer_code.replace(/\D/g, '')}`;
	}

	function formatTime(ts: string): string {
		return new Date(ts).toLocaleTimeString('th-TH', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Bangkok'
		});
	}

	function formatDate(ts: string): string {
		return new Date(ts).toLocaleDateString('th-TH', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			timeZone: 'Asia/Bangkok'
		});
	}

	const skillCatalog = useSkillOptions();
	const skills = $derived.by<SkillOption[]>(() => {
		if (!volunteer) return [];
		const map = new SvelteMap<string, SkillOption>();
		for (const value of volunteer.skills) {
			const option = resolveSkillOption(value, skillCatalog.options);
			if (option && !map.has(option.code)) {
				map.set(option.code, option);
			}
		}
		return Array.from(map.values());
	});
</script>

{#if volunteer}
	<Card.Root
		class="overflow-hidden border-2 shadow-lg {assignment?.status === 'checked_in'
			? 'border-emerald-300'
			: isEarly
				? 'border-amber-300'
				: 'border-border'}"
	>
		<div
			class="h-1.5 w-full {assignment?.status === 'checked_in'
				? 'bg-emerald-500'
				: isEarly
					? 'bg-amber-500'
					: 'bg-primary/60'}"
		></div>
		<Card.Content class="space-y-4">
			<div class="flex items-start justify-between gap-3">
				<div class="flex min-w-0 items-start gap-3">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary"
					>
						{volunteer.first_name.charAt(0)}
					</div>
					<div class="min-w-0">
						<h4 class="truncate text-base font-bold text-foreground">
							{fullName(volunteer)}
							{#if volunteer.nickname}<span class="font-normal text-muted-foreground"
									>({volunteer.nickname})</span
								>{/if}
						</h4>
						<p
							class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
						>
							{#if volunteer.phone}<span>{volunteer.phone}</span> •
							{/if}
							<span>ID: {volunteer.volunteer_code}</span> •
							<span class="font-mono text-[11px]">{ticketCode(volunteer)}</span>
						</p>
					</div>
				</div>
				{#if assignment?.status === 'checked_in'}
					<Badge
						class="shrink-0 gap-1 border-emerald-300 bg-emerald-50 text-emerald-700"
						variant="outline"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
						ปฏิบัติงานอยู่ในศูนย์
					</Badge>
				{:else if !assignment}
					<Badge variant="outline" class="shrink-0 gap-1 text-muted-foreground">ไม่มีกะวันนี้</Badge
					>
				{:else if blockedByIdentity}
					<Badge
						class="shrink-0 gap-1 border-amber-300 bg-amber-50 text-amber-700"
						variant="outline"
					>
						<Lock class="size-3" />
						รอยืนยันตัวตน
					</Badge>
				{:else if isEarly}
					<Badge
						class="shrink-0 gap-1 border-amber-300 bg-amber-50 text-amber-700"
						variant="outline"
					>
						<Clock class="size-3" />
						ยังไม่ได้เช็คอิน
					</Badge>
				{:else}
					<Badge variant="outline" class="shrink-0 gap-1 text-muted-foreground">
						{STATUS_LABELS[assignment.status]}
					</Badge>
				{/if}
			</div>

			{#if assignment}
				<div class="grid grid-cols-1 gap-3 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
					<div>
						<p class="text-[11px] font-semibold text-muted-foreground">
							ชื่องานและฝ่ายที่ได้รับมอบหมาย
						</p>
						<p class="mt-1 text-sm font-bold text-foreground">
							{job?.title ?? assignment.station}
						</p>
						{#if job?.description}
							<p class="mt-0.5 text-xs text-muted-foreground">{job.description}</p>
						{/if}
					</div>
					<div>
						<p class="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
							<Clock class="size-3" />
							กะเวลาปฏิบัติหน้าที่
						</p>
						<p class="mt-1 text-sm font-bold text-foreground">
							{formatTime(assignment.duty_window.start_ts)}–{formatTime(
								assignment.duty_window.end_ts
							)} น.
						</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							วันที่: {formatDate(assignment.duty_window.start_ts)}
						</p>
					</div>
				</div>

				{#if skills.length > 0}
					<div>
						<p class="mb-1.5 text-[11px] font-semibold text-muted-foreground">
							ทักษะความชำนาญที่ผ่านการรับรอง (SKILLS)
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each skills as skill, idx (`${skill.code}-${idx}`)}
								<Badge variant="outline" class="text-[11px]">
									{skill.icon}
									{skill.label}
								</Badge>
							{/each}
						</div>
					</div>
				{/if}

				{#if assignment.status === 'checked_in' && assignment.check_in_at}
					<div
						class="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3"
					>
						<LogIn class="mt-0.5 size-4 shrink-0 text-emerald-700" />
						<p class="text-xs text-emerald-900">
							<span class="font-bold"
								>เช็คอินเข้างานแล้วเมื่อ: {formatTime(assignment.check_in_at)} น.</span
							><br />
							{assignment.check_in_method === 'manual_override'
								? `บันทึกแทนโดย จนท. (${assignment.check_in_by ?? 'ไม่ระบุ'})`
								: 'สแกนรายงานตัวเข้ากะด้วยตนเอง (Self-Service QR)'}
						</p>
					</div>
				{:else if blockedByIdentity}
					<div class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
						<Lock class="mt-0.5 size-4 shrink-0 text-amber-700" />
						<p class="text-xs text-amber-900">
							ต้องให้เจ้าหน้าที่ตรวจบัตรประชาชนและยืนยันตัวตนก่อน จึงจะเช็คอินเข้ากะได้
						</p>
					</div>
				{:else if isEarly}
					<div class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
						<AlertCircle class="mt-0.5 size-4 shrink-0 text-amber-700" />
						<p class="text-xs text-amber-900">
							ยังไม่ถึงเวลาเข้างาน (กะเริ่ม {formatTime(assignment.duty_window.start_ts)} น.)<br />
							มาก่อนเวลา {earlyByLabel} (กะของท่านคือ {formatTime(
								assignment.duty_window.start_ts
							)}–{formatTime(assignment.duty_window.end_ts)} น.)
						</p>
					</div>
				{/if}
			{:else}
				<div class="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3">
					<AlertCircle class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<p class="text-xs text-muted-foreground">
						ไม่พบกะปฏิบัติงานของอาสาสมัครท่านนี้ในวันนี้ — โปรดตรวจสอบตารางกะ
						หรือมอบหมายกะก่อนเช็คอิน
					</p>
				</div>
			{/if}

			<div class="flex items-center gap-2 border-t border-border pt-3">
				<button
					type="button"
					onclick={onclear}
					class="flex h-11 shrink-0 items-center gap-0.5 rounded-xl px-2.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					ล้างหน้าจอ
				</button>

				{#if assignment?.status === 'checked_in'}
					<Button
						class="h-11 flex-1 gap-1.5 rounded-xl bg-destructive text-sm font-bold text-white shadow-sm hover:bg-destructive/90"
						onclick={oncheckout}
						disabled={checkOutPending}
					>
						{#if checkOutPending}
							<Loader class="size-4 animate-spin" />
						{:else}
							<LogOut class="size-4" />
						{/if}
						กดยืนยันเช็คเอาต์ออกงาน (Check-Out)
					</Button>
				{:else if blockedByIdentity}
					<Button disabled class="h-11 flex-1 rounded-xl text-sm font-bold">
						<Lock class="mr-1.5 size-4" />
						รอยืนยันตัวตนก่อนเช็คอิน
					</Button>
				{:else if notYetOnShift && isEarly}
					<Button
						class="h-11 flex-1 gap-1.5 rounded-xl bg-amber-500 text-sm font-bold text-white shadow-sm hover:bg-amber-600"
						onclick={oncheckin}
						disabled={checkInPending}
					>
						{#if checkInPending}
							<Loader class="size-4 animate-spin" />
						{:else}
							<Zap class="size-4" />
						{/if}
						ยืนยันเช็คอินล่วงหน้า/หน้างาน
					</Button>
				{:else if notYetOnShift}
					<Button
						class="h-11 flex-1 gap-1.5 rounded-xl bg-emerald-500 text-sm font-bold text-white shadow-sm hover:bg-emerald-600"
						onclick={oncheckin}
						disabled={checkInPending}
					>
						{#if checkInPending}
							<Loader class="size-4 animate-spin" />
						{:else}
							<LogIn class="size-4" />
						{/if}
						เช็คอิน
					</Button>
				{:else}
					<Button
						href={resolve('/back-office/volunteers')}
						variant="outline"
						class="h-11 flex-1 gap-1 rounded-xl text-sm font-bold"
					>
						ดูโปรไฟล์เต็ม
						<ChevronRight class="size-3.5" />
					</Button>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
{:else if notFoundCode}
	<Card.Root class="border-destructive/30 bg-destructive/5">
		<Card.Content class="flex items-start gap-3">
			<AlertCircle class="mt-0.5 size-5 shrink-0 text-destructive" />
			<div class="min-w-0">
				<p class="text-sm font-bold text-foreground">
					ไม่พบข้อมูลอาสาสมัครจากรหัส "{notFoundCode}"
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					โปรดตรวจสอบรหัส QR อีกครั้ง หรือค้นหาด้วยชื่อ/เบอร์โทรในช่อง "ค้นหาด่วน" ด้านซ้าย
				</p>
				<Button variant="outline" size="sm" class="mt-3" onclick={onclear}>ล้างหน้าจอ</Button>
			</div>
		</Card.Content>
	</Card.Root>
{:else}
	<Card.Root class="border-dashed border-border bg-muted/20">
		<Card.Content class="flex flex-col items-center gap-2 py-14 text-center">
			<div
				class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
			>
				<ScanLine class="size-8" />
			</div>
			<h3 class="text-base font-bold text-foreground">พร้อมสำหรับการสแกนรายงานตัว</h3>
			<p class="max-w-sm text-xs text-muted-foreground">
				สแกนตั๋ว QR จากมือถือของอาสาสมัคร หรือพิมพ์ค้นหาด้วยชื่อ/รหัส/เบอร์โทร
				เพื่อแสดงการ์ดยืนยันตัวตน
			</p>
		</Card.Content>
	</Card.Root>
{/if}
