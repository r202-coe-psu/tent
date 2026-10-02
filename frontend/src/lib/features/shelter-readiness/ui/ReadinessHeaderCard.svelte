<script lang="ts">
	import type { ReadinessHeaderInfo, ReadinessTier } from '../domain/readiness.types';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Building2 from '@lucide/svelte/icons/building-2';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

	interface Props {
		header: ReadinessHeaderInfo;
		tier: ReadinessTier;
		readOnly?: boolean;
		onTierChangeRequest: (newTier: ReadinessTier) => void;
	}

	let { header = $bindable(), tier, readOnly = false, onTierChangeRequest }: Props = $props();

	const tierDescriptions: Record<ReadinessTier, { title: string; subtitle: string }> = {
		community: {
			title: 'ระดับชุมชน (Community)',
			subtitle: 'ความจุ 10+ คนต่อหลัง เช่น บ้านพัก 1-2 ชั้น ชุมชน'
		},
		local_admin: {
			title: 'ระดับองค์กรปกครองส่วนท้องถิ่น (Local Admin)',
			subtitle: 'ความจุ 50–500 คนขึ้นไป เช่น วัด โรงเรียน มัสยิด โรงแรม'
		},
		city: {
			title: 'ระดับเมือง (City / Hub)',
			subtitle: 'ความจุ 5,000 คนขึ้นไป เช่น มหาวิทยาลัย ศูนย์ประชุมนานาชาติ'
		}
	};
</script>

<Card.Root class="border border-slate-200/80 bg-white shadow-2xs">
	<Card.Header class="border-b border-slate-100 pb-3">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2.5">
				<div class="rounded-lg bg-sky-50 p-2 text-sky-700">
					<Building2 class="size-5" />
				</div>
				<div>
					<Card.Title class="text-base font-bold text-slate-800">
						ข้อมูลทั่วไปของศูนย์พักพิงและระดับการตรวจประเมิน
					</Card.Title>
					<Card.Description class="text-xs text-slate-500">
						อ้างอิงตามคู่มือการจัดตั้งและการบริหารจัดการศูนย์พักพิงชั่วคราว ปภ. (2565)
					</Card.Description>
				</div>
			</div>

			<!-- Tier Selector Dropdown / Segment -->
			<div class="flex flex-col gap-1 sm:items-end">
				<span class="flex items-center gap-1 text-xs font-semibold text-slate-700">
					<ShieldAlert class="size-3.5 text-sky-600" />
					ระดับเกณฑ์มาตรฐาน (Tier):
				</span>
				{#if readOnly}
					<span
						class="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-900"
					>
						{tierDescriptions[tier].title}
					</span>
				{:else}
					<select
						class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs focus:border-sky-500 focus:outline-hidden"
						value={tier}
						onchange={(e) =>
							onTierChangeRequest((e.currentTarget as HTMLSelectElement).value as ReadinessTier)}
					>
						<option value="community">ระดับชุมชน (10+ คน / บ้านพัก)</option>
						<option value="local_admin">ระดับ อปท. (50-500 คน / วัด โรงเรียน)</option>
						<option value="city">ระดับเมือง (5,000+ คน / มหาวิทยาลัย)</option>
					</select>
				{/if}
			</div>
		</div>
	</Card.Header>

	<Card.Content class="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-4">
		<!-- ชื่อศูนย์พักพิง -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">ชื่อศูนย์พักพิง</Label>
			<Input
				bind:value={header.shelter_name}
				disabled={readOnly}
				placeholder="เช่น ศูนย์พักพิงวัดคลองแห"
				class="h-9 text-xs"
			/>
		</div>

		<!-- ชุมชน / พื้นที่ -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">ชุมชน / หมู่บ้าน</Label>
			<Input
				bind:value={header.community_name}
				disabled={readOnly}
				placeholder="เช่น ชุมชนคลองแห"
				class="h-9 text-xs"
			/>
		</div>

		<!-- หน่วยงาน/ผู้รับผิดชอบ -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">หน่วยงาน / ผู้รับผิดชอบ</Label>
			<Input
				bind:value={header.operating_agency}
				disabled={readOnly}
				placeholder="เช่น เทศบาลเมืองคลองแห"
				class="h-9 text-xs"
			/>
		</div>

		<!-- ความจุสูงสุด -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">ความจุสูงสุด (คน)</Label>
			<Input
				type="number"
				bind:value={header.max_capacity}
				disabled={readOnly}
				min="0"
				class="h-9 text-xs tabular-nums"
			/>
		</div>

		<!-- เบอร์โทรติดต่อ -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">เบอร์โทรศัพท์ติดต่อ</Label>
			<Input
				bind:value={header.phone_contact}
				disabled={readOnly}
				placeholder="เช่น 074-123456"
				class="h-9 text-xs"
			/>
		</div>

		<!-- ประเภทอาคาร -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">ประเภทอาคาร / สถานที่</Label>
			<Input
				bind:value={header.building_type}
				disabled={readOnly}
				placeholder="เช่น อาคารเรียน 2 ชั้น, ศาลาการเปรียญ"
				class="h-9 text-xs"
			/>
		</div>

		<!-- ผู้ประเมิน -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">ผู้ประเมิน</Label>
			<Input
				bind:value={header.assessor_name}
				disabled={readOnly}
				placeholder="ชื่อ-นามสกุล ผู้ประเมิน"
				class="h-9 text-xs"
			/>
		</div>

		<!-- วันที่ประเมิน -->
		<div class="space-y-1.5">
			<Label class="text-xs font-medium text-slate-600">วันที่ประเมิน</Label>
			<Input
				type="date"
				bind:value={header.assessed_date}
				disabled={readOnly}
				class="h-9 text-xs"
			/>
		</div>
	</Card.Content>
</Card.Root>
