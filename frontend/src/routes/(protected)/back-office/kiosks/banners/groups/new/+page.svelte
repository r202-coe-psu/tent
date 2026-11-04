<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useScannerDevices } from '$lib/features/kiosk-devices';
	import {
		KIOSK_BANNER_GROUP_LIMITS,
		KioskBannerGroupDevicePicker,
		isDuplicateGroupName,
		kioskBannerGroupInputSchema,
		useCreateKioskBannerGroup,
		useKioskBannerGroups
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Loader2 from '@lucide/svelte/icons/loader-2';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	const groupsQuery = useKioskBannerGroups(() => activeShelter);
	const devicesQuery = useScannerDevices(() => activeShelter);
	const create = useCreateKioskBannerGroup();

	const groups = $derived(groupsQuery.data ?? []);
	const devices = $derived(devicesQuery.data ?? []);

	let step = $state<1 | 2>(1);
	let name = $state('');
	let description = $state('');
	let selected = $state<string[]>([]);
	/** Shown only after the user tried to continue, so the empty form is not shouting. */
	let attempted = $state(false);

	const parsed = $derived(kioskBannerGroupInputSchema.safeParse({ name, description }));
	const nameError = $derived.by(() => {
		if (!parsed.success) {
			return parsed.error.issues.find((issue) => issue.path[0] === 'name')?.message ?? null;
		}
		return isDuplicateGroupName(groups, parsed.data.name)
			? 'มีกลุ่มชื่อนี้อยู่แล้วในศูนย์นี้'
			: null;
	});
	const descriptionError = $derived(
		parsed.success
			? null
			: (parsed.error.issues.find((issue) => issue.path[0] === 'description')?.message ?? null)
	);
	const canContinue = $derived(parsed.success && nameError === null);

	function next(event: SubmitEvent) {
		event.preventDefault();
		attempted = true;
		if (canContinue) step = 2;
	}

	/** A failed call is already toasted by the mutation hook. */
	async function save() {
		if (!parsed.success) return;
		let created;
		try {
			created = await create.mutateAsync({
				shelterCode: activeShelter,
				input: parsed.data,
				deviceIds: selected
			});
		} catch {
			return;
		}
		toast.success('สร้างกลุ่มแล้ว');
		await goto(resolve(`/back-office/kiosks/banners/groups/${encodeURIComponent(created._id)}`));
	}
</script>

<svelte:head>
	<title>สร้างกลุ่มแบนเนอร์ — SmartShelter</title>
</svelte:head>

<StaffPageShell title="สร้างกลุ่มแบนเนอร์" maxWidth="3xl">
	{#snippet meta()}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<p class="text-sm text-slate-600">
				ศูนย์: <span class="font-semibold text-slate-900">{activeShelter}</span>
			</p>
			<a
				href={resolve('/back-office/kiosks/banners')}
				class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
			>
				<ArrowLeft class="h-4 w-4" />
				กลับไปรายการกลุ่ม
			</a>
		</div>
	{/snippet}

	<div class={[spatial.container.staffPageCard, 'p-4 sm:p-6']}>
		<p class="mb-4 text-sm font-semibold text-slate-600" aria-live="polite">
			ขั้นที่ {step} จาก 2 — {step === 1 ? 'ชื่อกลุ่ม' : 'เลือกเครื่อง kiosk'}
		</p>

		{#if step === 1}
			<form class="flex flex-col gap-5" onsubmit={next} novalidate>
				<div class="flex flex-col gap-2">
					<Label for="group-name" class="text-sm font-semibold text-slate-700">
						ชื่อกลุ่ม <span class="text-destructive">*</span>
					</Label>
					<Input
						id="group-name"
						class="h-11"
						bind:value={name}
						maxlength={KIOSK_BANNER_GROUP_LIMITS.nameMax}
						placeholder="เช่น ตู้หน้าประตู"
						aria-invalid={attempted && nameError !== null}
						aria-describedby={attempted && nameError ? 'group-name-error' : undefined}
					/>
					{#if attempted && nameError}
						<p id="group-name-error" class="text-sm text-destructive">{nameError}</p>
					{/if}
				</div>
				<div class="flex flex-col gap-2">
					<Label for="group-description" class="text-sm font-semibold text-slate-700">
						คำอธิบาย (ไม่บังคับ)
					</Label>
					<Textarea
						id="group-description"
						rows={3}
						bind:value={description}
						maxlength={KIOSK_BANNER_GROUP_LIMITS.descriptionMax}
						aria-invalid={descriptionError !== null}
					/>
					{#if descriptionError}
						<p class="text-sm text-destructive">{descriptionError}</p>
					{/if}
				</div>
				<div class="flex justify-end">
					<Button type="submit" class="btn-primary-brand min-h-11">ถัดไป: เลือกเครื่อง</Button>
				</div>
			</form>
		{:else}
			<div class="flex flex-col gap-5">
				<p class="text-sm text-slate-600">
					เลือกตู้ kiosk ที่จะแสดงแบนเนอร์ของกลุ่ม <span class="font-semibold text-slate-900"
						>{name.trim()}</span
					> — เลือกภายหลังได้ ตู้ที่ไม่อยู่ในกลุ่มใดจะไม่แสดงแบนเนอร์
				</p>
				{#if devicesQuery.isLoading}
					<p class="py-8 text-center text-muted-foreground">กำลังโหลดรายการเครื่อง...</p>
				{:else if devicesQuery.error}
					<p class="py-8 text-center text-sm text-destructive">โหลดรายการเครื่องไม่สำเร็จ</p>
				{:else}
					<KioskBannerGroupDevicePicker {devices} {groups} groupId={null} bind:selected />
				{/if}
				<div class="flex flex-wrap justify-between gap-2">
					<Button
						type="button"
						variant="outline"
						class="min-h-11"
						disabled={create.isPending}
						onclick={() => (step = 1)}
					>
						ย้อนกลับ
					</Button>
					<Button
						type="button"
						class="btn-primary-brand min-h-11 gap-2"
						disabled={create.isPending}
						onclick={save}
					>
						{#if create.isPending}
							<Loader2 class="h-4 w-4 animate-spin" />
							กำลังสร้าง...
						{:else}
							สร้างกลุ่ม
						{/if}
					</Button>
				</div>
			</div>
		{/if}
	</div>
</StaffPageShell>
