<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { zoneLabel } from '../index';
	import { maskNationalId, type Evacuee, type Household } from '../domain/people';
	import { useMasterData } from '$lib/features/master-data';
	import { toast } from 'svelte-sonner';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';

	// Icons
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Copy from '@lucide/svelte/icons/copy';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import Users from '@lucide/svelte/icons/users';

	let {
		createdHousehold,
		selectedHead,
		selectedMembers = [],
		onFinish
	}: {
		createdHousehold: Household;
		selectedHead: Evacuee | null;
		selectedMembers: Evacuee[];
		onFinish: () => void;
	} = $props();

	// --- Queries for Master Data ---
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	// Resolve municipality_zone label
	const resolvedMunicipalityZone = $derived.by(() => {
		const code = createdHousehold.municipality_zone;
		if (!code) return null;
		const item = (municipalityZoneQuery.data?.items ?? []).find((i) => i.code === code);
		return item ? item.label : code;
	});

	// Resolve community label
	const resolvedCommunity = $derived.by(() => {
		const code = createdHousehold.community;
		if (!code) return null;
		const item = (communityQuery.data?.items ?? []).find((i) => i.code === code);
		return item ? item.label : code;
	});

	// --- Copy functionality ---
	let copied = $state(false);
	let copyTimeout: ReturnType<typeof setTimeout>;

	function copyToClipboard(text: string) {
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			navigator.clipboard
				.writeText(text)
				.then(() => {
					copied = true;
					toast.success('คัดลอกรหัสอ้างอิงครัวเรือนเรียบร้อยแล้ว');
					clearTimeout(copyTimeout);
					copyTimeout = setTimeout(() => {
						copied = false;
					}, 2000);
				})
				.catch(() => {
					toast.error('ไม่สามารถคัดลอกได้');
				});
		}
	}

	onDestroy(() => {
		if (copyTimeout) clearTimeout(copyTimeout);
	});

	// --- Address formatter ---
	function formatAddress(h: Household) {
		const parts = [];
		if (h.address_no) parts.push(h.address_no);
		if (h.village_no) {
			const v = h.village_no.replace(/^(ม\.|หมู่\s*)/, '');
			parts.push(`ม.${v}`);
		}
		if (h.subdistrict) {
			const s = h.subdistrict.replace(/^(ต\.|ตำบล\s*)/, '');
			parts.push(`ต.${s}`);
		}
		if (h.district) {
			const d = h.district.replace(/^(อ\.|อำเภอ\s*)/, '');
			parts.push(`อ.${d}`);
		}
		if (h.province) {
			const p = h.province.replace(/^(จ\.|จังหวัด\s*)/, '');
			parts.push(`จ.${p}`);
		}
		if (h.postal_code) parts.push(h.postal_code);
		return parts.join(' ');
	}

	const displayAddress = $derived(formatAddress(createdHousehold));

	const SPECIAL_NEED_CHIPS: Record<string, { emoji: string; label: string }> = {
		elderly: { emoji: '👴', label: 'ผู้สูงอายุ' },
		disabled: { emoji: '♿', label: 'พิการ' },
		pregnant: { emoji: '🤰', label: 'ครรภ์' },
		infant: { emoji: '👶', label: 'เด็กเล็ก' },
		chronic_illness: { emoji: '🩺', label: 'โรคเรื้อรัง' },
		bedridden: { emoji: '🛏️', label: 'ผู้ป่วยติดเตียง' }
	};

	let showQrModal = $state(false);

	const hasPets = $derived(!!(createdHousehold.pets && createdHousehold.pets.length > 0));
	const hasVehicles = $derived(
		!!(createdHousehold.vehicles && createdHousehold.vehicles.length > 0)
	);
</script>

<div
	class="mx-auto w-full max-w-4xl animate-in space-y-6 duration-300 fade-in slide-in-from-bottom-4"
>
	<!-- 1. Household Info Card -->
	<div
		class="relative overflow-hidden rounded-2xl border border-border bg-card p-6 text-left shadow-sm"
	>
		<div class="flex items-start gap-4">
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"
			>
				<CheckCircle class="size-6" />
			</div>
			<div class="min-w-0 flex-1">
				<h3 class="dark:text-slate-550 text-lg font-bold text-slate-900">
					จัดกลุ่มครอบครัวและออกรหัสครัวเรือนสำเร็จ!
				</h3>
				<p class="mt-0.5 text-sm text-muted-foreground">
					ครัวเรือนได้รับการจัดตั้งแล้วในระบบ สถานะ:
					<span
						class="ml-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200"
					>
						เช็คอินเข้าศูนย์พักพิงแล้ว (Checked-in)
					</span>
				</p>
			</div>

			<!-- Click to Copy ID Badge -->
			<button
				type="button"
				onclick={() => copyToClipboard(createdHousehold._id)}
				class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-200/50 bg-slate-50 px-2.5 py-1 font-mono text-xs text-muted-foreground transition-all hover:bg-slate-100 hover:text-foreground dark:border-slate-800 dark:bg-slate-900"
				title="คลิกเพื่อคัดลอกรหัสอ้างอิง"
			>
				<span class="max-w-[120px] truncate">ID: {createdHousehold._id}</span>
				{#if copied}
					<CheckCheck class="dark:text-emerald-450 size-3 text-emerald-600" />
				{:else}
					<Copy class="size-3" />
				{/if}
			</button>
		</div>

		<div
			class="mt-6 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 dark:border-slate-800/80"
		>
			<div>
				<span class="text-xs text-muted-foreground">ชื่อครัวเรือน</span>
				<p class="dark:text-slate-250 mt-0.5 font-semibold text-slate-800">
					{createdHousehold.label}
				</p>
			</div>
			<div>
				<span class="text-xs text-muted-foreground">หัวหน้าครัวเรือน</span>
				<p class="dark:text-slate-250 mt-0.5 font-semibold text-slate-800">
					{selectedHead ? `${selectedHead.first_name} ${selectedHead.last_name}` : '—'}
				</p>
			</div>
			<div>
				<span class="text-xs text-muted-foreground">โซนที่จัดสรร</span>
				<p class="dark:text-slate-250 mt-0.5 font-semibold text-slate-800">
					{selectedHead?.current_stay?.zone ? zoneLabel(selectedHead.current_stay.zone) : '—'}
				</p>
			</div>
			<div>
				<span class="text-xs text-muted-foreground">เขตพื้นที่ / ชุมชน</span>
				<p class="dark:text-slate-250 mt-0.5 font-semibold text-slate-800">
					{resolvedMunicipalityZone || 'ไม่ได้ระบุ'}
					{#if resolvedCommunity}
						· ชุมชน {resolvedCommunity}
					{/if}
					{#if createdHousehold.subdistrict}
						· ต.{createdHousehold.subdistrict}
					{/if}
				</p>
			</div>
			<div class="col-span-1 sm:col-span-2">
				<span class="text-xs text-muted-foreground">ที่อยู่เดิมตามทะเบียนบ้าน / ภูมิลำเนา</span>
				<p class="dark:text-slate-250 mt-0.5 font-medium text-slate-800">
					{displayAddress || 'ไม่ได้ระบุ'}
				</p>
			</div>

			<!-- Additional details: Pets / Vehicles / Assets if any -->
			{#if hasPets}
				<div class="col-span-1 sm:col-span-2">
					<span class="text-xs text-muted-foreground">สัตว์เลี้ยงที่พามาด้วย</span>
					<div class="mt-1 flex flex-wrap gap-1.5">
						{#each createdHousehold.pets as pet, i (i)}
							{@const speciesMap = {
								dog: 'สุนัข',
								cat: 'แมว',
								other: 'สัตว์เลี้ยงอื่นๆ'
							}}
							<span
								class="rounded border border-amber-200/50 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
							>
								{speciesMap[pet.species] || pet.species}: {pet.count} ตัว
								{#if pet.has_cage}
									(มีกรง)
								{/if}
							</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if hasVehicles}
				<div class="col-span-1 sm:col-span-2">
					<span class="text-xs text-muted-foreground">ยานพาหนะ</span>
					<div class="mt-1 flex flex-wrap gap-1.5">
						{#each createdHousehold.vehicles as vehicle, i (i)}
							{@const typeMap = {
								car: 'รถยนต์',
								motorcycle: 'รถจักรยานยนต์',
								other: 'ยานพาหนะอื่นๆ'
							}}
							<span
								class="rounded border border-blue-200/50 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
							>
								{typeMap[vehicle.type] || vehicle.type}
								{#if vehicle.license_plate}
									({vehicle.license_plate}){/if}
							</span>
						{/each}
					</div>
				</div>
			{/if}

			{#if createdHousehold.assets?.description}
				<div class="col-span-1 sm:col-span-2">
					<span class="text-xs text-muted-foreground">ทรัพย์สินสำคัญที่ระบุ</span>
					<p class="dark:text-slate-350 mt-0.5 leading-relaxed font-medium text-slate-700">
						{createdHousehold.assets.description}
					</p>
				</div>
			{/if}

			{#if createdHousehold.notes}
				<div class="col-span-1 sm:col-span-2">
					<span class="text-xs text-muted-foreground">หมายเหตุเพิ่มเติม</span>
					<p class="dark:text-slate-350 mt-0.5 font-medium text-slate-700">
						{createdHousehold.notes}
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- 2. Member List Card -->
	<div class="rounded-2xl border border-border bg-card p-6 text-left shadow-sm">
		<div class="mb-4 flex items-center justify-between gap-4">
			<h3 class="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-200">
				<Users class="size-5 text-primary" />
				รายชื่อสมาชิกในบ้าน ({selectedMembers.length} คน)
			</h3>
		</div>

		<div class="overflow-x-auto rounded-xl border border-border">
			<table class="w-full border-collapse text-left text-sm">
				<thead>
					<tr class="border-b bg-muted/40">
						<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">ชื่อ-นามสกุล</th>
						<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">บทบาท</th>
						<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">ระบุตัวตน / โทร</th>
						<th class="p-3 font-semibold text-slate-700 dark:text-slate-300">กลุ่มช่วยเหลือพิเศษ</th
						>
					</tr>
				</thead>
				<tbody>
					{#each selectedMembers as m (m._id)}
						{@const isHead = m._id === createdHousehold.head_evacuee_id}
						<tr class="border-b transition-colors last:border-0 hover:bg-muted/10">
							<td class="p-3 font-bold text-slate-900 dark:text-slate-100">
								{m.first_name}
								{m.last_name}
								{#if m.nickname}
									<span class="text-xs font-normal text-muted-foreground">({m.nickname})</span>
								{/if}
							</td>
							<td class="p-3">
								{#if isHead}
									<span class="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
										หัวหน้าครอบครัว
									</span>
								{:else}
									<span
										class="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
									>
										ลูกบ้าน
									</span>
								{/if}
							</td>
							<td class="p-3 font-mono text-xs">
								<div>ID: {maskNationalId(m.person_id?.number)}</div>
								{#if m.phone}
									<div class="opacity-75">{m.phone}</div>
								{/if}
							</td>
							<td class="p-3">
								<div class="flex flex-wrap gap-1">
									{#if m.special_needs?.length > 0}
										{#each m.special_needs as need (need)}
											<span
												class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-2xs font-medium text-amber-700"
											>
												{SPECIAL_NEED_CHIPS[need]?.emoji || '⚠️'}
												{SPECIAL_NEED_CHIPS[need]?.label || need}
											</span>
										{/each}
									{:else}
										<span class="text-xs text-muted-foreground italic">ไม่มี</span>
									{/if}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- 3. Bottom Action Row -->
	<div
		class="mt-8 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<p class="text-left text-xs text-muted-foreground">
			💡 จัดกลุ่มครอบครัวสำเร็จแล้ว
			สมาชิกทุกคนจะผูกอยู่กับครัวเรือนนี้และมีสถานะเช็คอินอยู่ในโซนที่ระบุ
		</p>
		<div class="flex items-center gap-2 self-end sm:self-auto">
			{#if selectedHead}
				<Button
					variant="outline"
					class="h-11 px-6 font-semibold"
					onclick={() => (showQrModal = true)}
				>
					ออกและพิมพ์ QR ประจำตัว
				</Button>
			{/if}
			<Button
				onclick={onFinish}
				class="h-11 bg-emerald-600 px-8 font-semibold text-white hover:bg-emerald-700"
			>
				เสร็จสิ้นการจัดกลุ่มครอบครัว ✔
			</Button>
		</div>
	</div>
</div>

{#if showQrModal && selectedHead}
	<EvacueeQrModal show={showQrModal} evacuee={selectedHead} onClose={() => (showQrModal = false)} />
{/if}
