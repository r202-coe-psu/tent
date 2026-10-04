<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import type { PreRegistrationProfile } from '../domain/schemas';
	import { useUnassignedProfile } from '../application/queries';

	let { unassignedId }: { unassignedId: string } = $props();

	const unassignedQuery = useUnassignedProfile(() => unassignedId);

	const profile = $derived(unassignedQuery.data as PreRegistrationProfile | undefined);
	const loading = $derived(unassignedQuery.isPending);
	const isError = $derived(unassignedQuery.isError);

	function formatWhen(value: string | null | undefined): string {
		if (!value) return '—';
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return value;
		return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<StaffPageShell
	title="โปรไฟล์ Pre-registration"
	description="ดูอย่างเดียว — ไม่มีการแก้ไขหรือเคลมจากหน้านี้"
	maxWidth="6xl"
>
	{#snippet actions()}
		<Button variant="outline" size="sm" href={resolve('/system-management/pre-registrations')}>
			กลับรายการ
		</Button>
	{/snippet}

	{#if loading && !profile}
		<div class="space-y-4">
			<Skeleton class="h-40 w-full rounded-xl" />
			<Skeleton class="h-32 w-full rounded-xl" />
			<Skeleton class="h-40 w-full rounded-xl" />
		</div>
	{:else if isError || !profile}
		<p
			class="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-900"
		>
			ไม่พบข้อมูลโปรไฟล์
		</p>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<Badge class="border border-sky-200 bg-sky-50 text-sky-900">ยังไม่ผูกศูนย์</Badge>
			<Badge variant="outline" class="border-slate-200 text-slate-700">
				{profile.queue_status}
			</Badge>
			{#if profile.shelter_href}
				<a
					href={resolve(profile.shelter_href as '/back-office/evacuee-management')}
					class="text-sm font-semibold text-[#0284C7] hover:underline"
				>
					ไปที่ศูนย์
				</a>
			{/if}
		</div>

		<Card.Root class={spatial.container.staffPageCard}>
			<Card.Header>
				<Card.Title class="text-lg font-bold text-slate-900">ข้อมูลบุคคล</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-3 sm:grid-cols-2">
				<div>
					<p class="text-sm font-semibold text-slate-700">ชื่อ</p>
					<p class="text-base text-slate-900">{profile.display_name}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">เลขบัตร (ปกปิด)</p>
					<p class="text-base text-slate-900 tabular-nums">{profile.person_id_masked ?? '—'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">โทรศัพท์</p>
					<p class="text-base text-slate-900 tabular-nums">{profile.phone ?? '—'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">ประเทศ</p>
					<p class="text-base text-slate-900">{profile.country ?? '—'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">ปีเกิด / อายุ</p>
					<p class="text-base text-slate-900 tabular-nums">
						{profile.birth_year ?? '—'}
						{#if profile.age != null}
							· {profile.age} ปี
						{/if}
					</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">ลงทะเบียนเมื่อ</p>
					<p class="text-base text-slate-900">{formatWhen(profile.registered_at)}</p>
				</div>
				{#if profile.vulnerable_groups.length > 0}
					<div class="sm:col-span-2">
						<p class="text-sm font-semibold text-slate-700">กลุ่มเปราะบาง</p>
						<p class="text-base text-slate-900">{profile.vulnerable_groups.join(', ')}</p>
					</div>
				{/if}
				{#if profile.special_needs.length > 0}
					<div class="sm:col-span-2">
						<p class="text-sm font-semibold text-slate-700">ความต้องการพิเศษ</p>
						<p class="text-base text-slate-900">{profile.special_needs.join(', ')}</p>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class={spatial.container.staffPageCard}>
			<Card.Header>
				<Card.Title class="text-lg font-bold text-slate-900">ที่อยู่อาศัย</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if !profile.residence}
					<p class="text-sm text-slate-500">ไม่มีข้อมูลที่อยู่</p>
				{:else}
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<p class="text-sm font-semibold text-slate-700">ประเภทที่อยู่อาศัย</p>
							<p class="text-base text-slate-900">{profile.residence.housing_type ?? '—'}</p>
						</div>
						<div>
							<p class="text-sm font-semibold text-slate-700">เลขที่</p>
							<p class="text-base text-slate-900">{profile.residence.address_no ?? '—'}</p>
						</div>
						<div class="sm:col-span-2">
							<p class="text-sm font-semibold text-slate-700">จุดสังเกต</p>
							<p class="text-base text-slate-900">{profile.residence.landmark ?? '—'}</p>
						</div>
						<div>
							<p class="text-sm font-semibold text-slate-700">จังหวัด</p>
							<p class="text-base text-slate-900">{profile.residence.province ?? '—'}</p>
						</div>
						<div>
							<p class="text-sm font-semibold text-slate-700">อำเภอ</p>
							<p class="text-base text-slate-900">{profile.residence.district ?? '—'}</p>
						</div>
						<div>
							<p class="text-sm font-semibold text-slate-700">ตำบล</p>
							<p class="text-base text-slate-900">{profile.residence.subdistrict ?? '—'}</p>
						</div>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class={spatial.container.staffPageCard}>
			<Card.Header>
				<Card.Title class="text-lg font-bold text-slate-900">สมาชิกในครัวเรือน</Card.Title>
				<Card.Description class="text-sm text-slate-500">
					{profile.members.length} คน
				</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if profile.members.length === 0}
					<p class="text-sm text-slate-500">ไม่มีรายชื่อสมาชิก</p>
				{:else}
					<ul class="divide-y divide-slate-100 rounded-xl border border-slate-200/80">
						{#each profile.members as member (member.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
								<div>
									<p class="font-medium text-slate-900">{member.display_name}</p>
									<p class="text-sm text-slate-500">
										{member.country ?? '—'}
										{#if member.birth_year != null}
											· พ.ศ. {member.birth_year}
										{/if}
									</p>
								</div>
								{#if member.status}
									<Badge variant="outline" class="border-slate-200 text-slate-700">
										{member.status}
									</Badge>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class={spatial.container.staffPageCard}>
			<Card.Header>
				<Card.Title class="text-lg font-bold text-slate-900">สถานะคิว / ศูนย์</Card.Title>
			</Card.Header>
			<Card.Content class="grid gap-3 sm:grid-cols-2">
				<div>
					<p class="text-sm font-semibold text-slate-700">สถานะคิว</p>
					<p class="text-base text-slate-900">{profile.queue_status}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">ช่องทางลงทะเบียน</p>
					<p class="text-base text-slate-900">{profile.registered_via ?? '—'}</p>
				</div>
				<div>
					<p class="text-sm font-semibold text-slate-700">ศูนย์</p>
					<p class="text-base text-slate-900">
						{profile.shelter_name ?? '—'}
						{#if profile.shelter_code}
							<span class="text-sm text-slate-500">({profile.shelter_code})</span>
						{/if}
					</p>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</StaffPageShell>
