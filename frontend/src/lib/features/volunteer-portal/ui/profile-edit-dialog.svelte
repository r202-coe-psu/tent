<script lang="ts">
	/**
	 * "แก้ไขโปรไฟล์" — the volunteer's own profile, from the Access Portal.
	 *
	 * Editable: skills. Everything else on this screen is shown read-only, and for two
	 * different reasons that the copy keeps apart:
	 *
	 *  - **ชื่อ / เบอร์ / ศูนย์** are identity the shelter recorded. The phone in
	 *    particular is the key this portal signs in by and the key applications dedupe
	 *    on, so changing it here would lock the volunteer out of their own roster.
	 *  - **ยืนยันตัวตน / รหัสอาสา** are staff decisions. They are not on the request
	 *    schema at all, so a forged body cannot express a change to them either.
	 *
	 * The skill list comes from Master Data (`volunteer_skills`), the same list the back
	 * office settings screen edits — so a skill added there appears here without a deploy
	 * (FR-VOL-08.5). A skill already on the profile that the list no longer carries is
	 * kept and shown, never silently dropped by opening this dialog, and if the lookup
	 * fails the volunteer can still see and keep what they have.
	 */
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { useUpdateProfileMutation, useVolunteerSkills } from '../application/queries';
	import type { PortalCredential, VolunteerProfile } from '../domain/volunteer';

	let {
		open = $bindable(false),
		profile,
		credential
	}: {
		open?: boolean;
		profile: VolunteerProfile | null;
		credential: PortalCredential | null;
	} = $props();

	const save = useUpdateProfileMutation(() => credential);
	// Scoped to the shelter that holds the profile, so a centre with its own skill list
	// offers its own — falling back to the global list when there is no profile yet.
	const skillsQuery = useVolunteerSkills(() => profile?.shelter_codes[0]);

	let selected = $state<string[]>([]);
	let error = $state('');

	// Reload from the server's copy every time the dialog opens, so a cancelled edit
	// leaves nothing behind and a staff-side change made meanwhile is what gets shown.
	$effect(() => {
		if (open) {
			selected = [...(profile?.skills ?? [])];
			error = '';
		}
	});

	/** Master-list skills, plus anything on the profile the list no longer carries. */
	const options = $derived.by(() => {
		const master = skillsQuery.data ?? [];
		// Stored on the profile as the label, which is what the apply form sends and what
		// the back office filters on — the code is master data's own key, not the value.
		const known = master.map((entry) => ({
			key: entry.label,
			label: entry.label,
			description: entry.description,
			controlled: entry.category === 'controlled'
		}));
		const extras = (profile?.skills ?? [])
			.filter((skill) => !known.some((entry) => entry.key === skill))
			.map((skill) => ({ key: skill, label: skill, description: '', controlled: false }));
		return [...known, ...extras];
	});

	const dirty = $derived(
		selected.length !== (profile?.skills.length ?? 0) ||
			selected.some((skill) => !profile?.skills.includes(skill))
	);

	function toggle(key: string) {
		selected = selected.includes(key)
			? selected.filter((skill) => skill !== key)
			: [...selected, key];
	}

	async function submit() {
		error = '';
		try {
			await save.mutateAsync(selected);
			toast.success('บันทึกโปรไฟล์แล้ว');
			open = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'บันทึกโปรไฟล์ไม่สำเร็จ';
			toast.error(error);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
		<Dialog.Title class="flex items-center gap-2">
			<BadgeCheck class="h-4.5 w-4.5 text-primary" />
			แก้ไขโปรไฟล์จิตอาสา
		</Dialog.Title>

		{#if !profile}
			<p class="py-8 text-center text-sm text-muted-foreground">
				ยังไม่พบโปรไฟล์ของคุณในระบบ — ลองจองภารกิจสักงานก่อน แล้วกลับมาแก้ไขได้ที่นี่
			</p>
		{:else}
			<div class="space-y-5">
				<!-- Identity: recorded by the shelter, not editable here. -->
				<div class="space-y-2 rounded-2xl border border-border bg-muted/20 p-4">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm font-bold text-foreground">
								{profile.first_name}
								{profile.last_name}
							</p>
							<p class="mt-0.5 text-2xs text-muted-foreground">
								{profile.volunteer_code || 'ยังไม่มีรหัสอาสา'} · {profile.phone_masked}
							</p>
						</div>
						{#if profile.identity_verified}
							<span
								class="flex shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-3xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
							>
								<CheckCircle2 class="h-3 w-3" />
								ยืนยันตัวตนแล้ว
							</span>
						{/if}
					</div>
					{#if profile.shelter_codes.length > 0}
						<p class="text-2xs text-muted-foreground">
							ศูนย์ที่มีโปรไฟล์: {profile.shelter_codes.join(' · ')}
						</p>
					{/if}
					<p class="flex items-start gap-1.5 text-3xs text-muted-foreground">
						<Lock class="mt-0.5 h-3 w-3 shrink-0" />
						ชื่อ เบอร์โทร และการยืนยันตัวตน แก้ไขได้ที่เจ้าหน้าที่ศูนย์เท่านั้น — เบอร์โทรเป็นรหัสที่ใช้เข้าระบบนี้
					</p>
				</div>

				<!-- The one thing the volunteer owns. -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<p class="text-sm font-bold text-foreground">ทักษะของฉัน</p>
						<span class="text-2xs text-muted-foreground">เลือกแล้ว {selected.length} ทักษะ</span>
					</div>

					<div class="flex flex-wrap gap-2">
						{#each options as option (option.key)}
							{@const isSelected = selected.includes(option.key)}
							<button
								type="button"
								onclick={() => toggle(option.key)}
								aria-pressed={isSelected}
								title={option.controlled
									? 'ทักษะควบคุม — เจ้าหน้าที่ต้องตรวจคุณสมบัติก่อนรับงานที่ใช้ทักษะนี้'
									: option.description || undefined}
								class="flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold transition-all {isSelected
									? 'border-primary bg-primary text-primary-foreground shadow-sm'
									: 'border-border bg-card text-foreground hover:bg-muted'}"
							>
								{#if isSelected}
									<CheckCircle2 class="h-3.5 w-3.5" />
								{/if}
								{option.label}
								{#if option.controlled}
									<span class="text-3xs font-normal opacity-70">(ควบคุม)</span>
								{/if}
							</button>
						{/each}
					</div>

					<div
						class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/40"
					>
						<ShieldAlert class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
						<p class="text-3xs leading-relaxed text-amber-900 dark:text-amber-200">
							ทักษะที่เลือกเป็นข้อมูลที่ท่านแจ้งเอง ใช้ประกอบการพิจารณาของเจ้าหน้าที่ —
							ภารกิจที่ต้องใช้ทักษะควบคุม (เช่น การแพทย์) ยังต้องผ่านการตรวจคุณสมบัติเหมือนเดิม
						</p>
					</div>
				</div>

				{#if error}
					<p class="text-sm font-medium text-destructive" role="alert">{error}</p>
				{/if}

				<div class="flex justify-end gap-2">
					<Button variant="outline" onclick={() => (open = false)}>ยกเลิก</Button>
					<Button class="gap-1.5" disabled={!dirty || save.isPending} onclick={submit}>
						{#if save.isPending}
							<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						{/if}
						บันทึกการเปลี่ยนแปลง
					</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
