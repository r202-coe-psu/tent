<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { spatial } from '$lib/tokens';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { KIOSK_SCREEN_TYPES } from '$lib/features/shared';
	import { useScannerDevices } from '$lib/features/kiosk-devices';
	import {
		KIOSK_BANNER_GROUP_LIMITS,
		KioskBannerGroupDevicePicker,
		KioskBannerScreenCard,
		isDuplicateGroupName,
		kioskBannerGroupInputSchema,
		summarizeScreen,
		useDeleteKioskBannerGroup,
		useKioskBannerGroup,
		useKioskBannerGroups,
		useKioskBanners,
		useSetKioskBannerGroupDevices,
		useUpdateKioskBannerGroup
	} from '$lib/features/kiosk-banners';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	/** Every role (SA included) works on the shelter picked in the back-office shelter switcher. */
	const activeShelter = $derived(shelterStore.selectedShelterCode ?? getShelterCode());

	/** SvelteKit already decodes the segment (`kiosk_banner_group%3A01A` → `kiosk_banner_group:01A`). */
	const groupId = $derived(page.params.group ?? '');

	const listHref = resolve('/back-office/kiosks/banners');

	const groupQuery = useKioskBannerGroup(() => groupId);
	const groupsQuery = useKioskBannerGroups(() => activeShelter);
	const devicesQuery = useScannerDevices(() => activeShelter);
	const currentQuery = useKioskBanners(
		() => activeShelter,
		() => 'current'
	);
	const expiredQuery = useKioskBanners(
		() => activeShelter,
		() => 'expired'
	);

	const updateGroup = useUpdateKioskBannerGroup();
	const setDevices = useSetKioskBannerGroupDevices();
	const deleteGroup = useDeleteKioskBannerGroup();

	/** Evaluation time for "active now"; ticks so a page left open follows schedule changes. */
	let now = $state(new Date());
	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(timer);
	});

	const group = $derived(groupQuery.data);
	const groups = $derived(groupsQuery.data ?? []);
	const devices = $derived(devicesQuery.data ?? []);
	const members = $derived(
		devices.filter((device) => group?.device_ids.includes(device.device_id))
	);
	const loading = $derived(groupQuery.isLoading);

	function summaryOf(screenType: (typeof KIOSK_SCREEN_TYPES)[number]) {
		return summarizeScreen(
			currentQuery.data ?? [],
			expiredQuery.data ?? [],
			{ group_id: groupId, screen_type: screenType },
			now
		);
	}

	const screenHref = (screenType: string) =>
		resolve(`/back-office/kiosks/banners/groups/${encodeURIComponent(groupId)}/${screenType}`);

	const newBannerHref = $derived(
		resolve(`/back-office/kiosks/banners/new?group=${encodeURIComponent(groupId)}&screen=compact`)
	);

	// Rename dialog
	let renameOpen = $state(false);
	let nameDraft = $state('');
	let descriptionDraft = $state('');
	let renameAttempted = $state(false);

	const renameParsed = $derived(
		kioskBannerGroupInputSchema.safeParse({ name: nameDraft, description: descriptionDraft })
	);
	const renameNameError = $derived.by(() => {
		if (!renameParsed.success) {
			return renameParsed.error.issues.find((issue) => issue.path[0] === 'name')?.message ?? null;
		}
		return isDuplicateGroupName(groups, renameParsed.data.name, groupId)
			? 'มีกลุ่มชื่อนี้อยู่แล้วในศูนย์นี้'
			: null;
	});
	const renameDescriptionError = $derived(
		renameParsed.success
			? null
			: (renameParsed.error.issues.find((issue) => issue.path[0] === 'description')?.message ??
					null)
	);

	function openRename() {
		if (!group) return;
		nameDraft = group.name;
		descriptionDraft = group.description ?? '';
		renameAttempted = false;
		renameOpen = true;
	}

	/** A failed call is already toasted by the mutation hook. */
	async function saveRename(event: SubmitEvent) {
		event.preventDefault();
		renameAttempted = true;
		if (!group || !renameParsed.success || renameNameError !== null) return;
		try {
			await updateGroup.mutateAsync({ id: group._id, rev: group._rev, input: renameParsed.data });
		} catch {
			return;
		}
		toast.success('บันทึกข้อมูลกลุ่มแล้ว');
		renameOpen = false;
	}

	// Manage-devices dialog
	let devicesOpen = $state(false);
	let selected = $state<string[]>([]);

	function openDevices() {
		if (!group) return;
		selected = [...group.device_ids];
		devicesOpen = true;
	}

	async function saveDevices() {
		if (!group) return;
		try {
			await setDevices.mutateAsync({ id: group._id, deviceIds: selected });
		} catch {
			return;
		}
		toast.success('บันทึกเครื่องของกลุ่มแล้ว');
		devicesOpen = false;
	}

	// Delete dialog
	let deleteOpen = $state(false);

	/** The server refuses (409) while the group still has banners; the hook toasts its reason. */
	async function confirmDelete() {
		if (!group) return;
		try {
			await deleteGroup.mutateAsync({ id: group._id, rev: group._rev });
		} catch {
			return;
		}
		toast.success(`ลบกลุ่ม "${group.name}" แล้ว`);
		await goto(listHref);
	}
</script>

<svelte:head>
	<title>{group ? `กลุ่ม ${group.name}` : 'กลุ่มแบนเนอร์'} — SmartShelter</title>
</svelte:head>

{#snippet backLink()}
	<a
		href={listHref}
		class="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
	>
		<ArrowLeft class="h-4 w-4" />
		กลับไปรายการกลุ่ม
	</a>
{/snippet}

{#if loading}
	<StaffPageShell title="กลุ่มแบนเนอร์">
		<p class="py-16 text-center text-muted-foreground">กำลังโหลดกลุ่มแบนเนอร์...</p>
	</StaffPageShell>
{:else if !group}
	<StaffPageShell title="ไม่พบกลุ่มแบนเนอร์">
		{#snippet meta()}
			{@render backLink()}
		{/snippet}
		<div class={[spatial.container.staffPageCard, 'p-4 sm:p-6']}>
			<p class="py-12 text-center text-slate-700">
				ไม่พบกลุ่มแบนเนอร์นี้ — อาจถูกลบไปแล้ว หรืออยู่ในศูนย์อื่น
			</p>
		</div>
	</StaffPageShell>
{:else}
	<StaffPageShell title={group.name} description={group.description ?? undefined}>
		{#snippet meta()}
			<div class="flex flex-col gap-2">
				<div class="flex flex-wrap items-center gap-x-4 gap-y-1">
					<p class="text-sm text-slate-600">
						ศูนย์: <span class="font-semibold text-slate-900">{activeShelter}</span>
					</p>
					{@render backLink()}
				</div>
				<div class="flex flex-wrap items-center gap-2" aria-label="เครื่องในกลุ่ม">
					<Cpu class="size-4 text-slate-600" aria-hidden="true" />
					{#if members.length === 0}
						<span class="text-sm text-slate-600">
							ยังไม่มีเครื่องในกลุ่ม — ตู้จะไม่แสดงแบนเนอร์จนกว่าจะเลือกเครื่อง
						</span>
					{:else}
						{#each members as device (device.device_id)}
							<span
								class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-sm font-medium text-slate-800"
							>
								{device.name}
							</span>
						{/each}
					{/if}
				</div>
			</div>
		{/snippet}
		{#snippet actions()}
			<Button variant="outline" class="min-h-11 shrink-0 gap-2" onclick={openRename}>
				<Pencil class="h-4 w-4" />
				แก้ชื่อกลุ่ม
			</Button>
			<Button variant="outline" class="min-h-11 shrink-0 gap-2" onclick={openDevices}>
				<Cpu class="h-4 w-4" />
				จัดการเครื่อง
			</Button>
			<Button
				variant="outline"
				class="min-h-11 shrink-0 gap-2 border-red-200 text-destructive hover:bg-red-50 hover:text-destructive"
				onclick={() => (deleteOpen = true)}
			>
				<Trash2 class="h-4 w-4" />
				ลบกลุ่ม
			</Button>
			<Button href={newBannerHref} class="btn-primary-brand min-h-11 shrink-0 gap-2">
				<Plus class="h-4 w-4" />
				สร้างแบนเนอร์
			</Button>
		{/snippet}

		<div class={[spatial.container.staffPageCard, 'p-4 sm:p-6']}>
			{#if currentQuery.isLoading || expiredQuery.isLoading}
				<p class="py-16 text-center text-muted-foreground">กำลังโหลดรายการแบนเนอร์...</p>
			{:else if currentQuery.error || expiredQuery.error}
				<p class="py-16 text-center text-sm text-destructive">โหลดรายการแบนเนอร์ไม่สำเร็จ</p>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2">
					{#each KIOSK_SCREEN_TYPES as type (type)}
						<KioskBannerScreenCard
							screen={type}
							summary={summaryOf(type)}
							href={screenHref(type)}
						/>
					{/each}
				</div>
			{/if}
		</div>
	</StaffPageShell>

	<Dialog.Root bind:open={renameOpen}>
		<Dialog.Content class="gap-5 rounded-2xl sm:max-w-[480px]">
			<Dialog.Header>
				<Dialog.Title class="text-lg font-bold text-slate-900">แก้ชื่อกลุ่ม</Dialog.Title>
				<Dialog.Description class="text-sm text-slate-500">
					ชื่อต้องไม่ซ้ำกับกลุ่มอื่นในศูนย์เดียวกัน
				</Dialog.Description>
			</Dialog.Header>
			<form id="rename-group-form" class="flex flex-col gap-4" onsubmit={saveRename} novalidate>
				<div class="flex flex-col gap-2">
					<Label for="rename-name" class="text-sm font-semibold text-slate-700">
						ชื่อกลุ่ม <span class="text-destructive">*</span>
					</Label>
					<Input
						id="rename-name"
						class="h-11"
						bind:value={nameDraft}
						maxlength={KIOSK_BANNER_GROUP_LIMITS.nameMax}
						aria-invalid={renameAttempted && renameNameError !== null}
					/>
					{#if renameAttempted && renameNameError}
						<p class="text-sm text-destructive">{renameNameError}</p>
					{/if}
				</div>
				<div class="flex flex-col gap-2">
					<Label for="rename-description" class="text-sm font-semibold text-slate-700">
						คำอธิบาย (ไม่บังคับ)
					</Label>
					<Textarea
						id="rename-description"
						rows={3}
						bind:value={descriptionDraft}
						maxlength={KIOSK_BANNER_GROUP_LIMITS.descriptionMax}
					/>
					{#if renameDescriptionError}
						<p class="text-sm text-destructive">{renameDescriptionError}</p>
					{/if}
				</div>
			</form>
			<Dialog.Footer class="gap-2">
				<Button
					type="button"
					variant="outline"
					class="min-h-11"
					onclick={() => (renameOpen = false)}
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					form="rename-group-form"
					class="btn-primary-brand min-h-11 gap-2"
					disabled={updateGroup.isPending}
				>
					{#if updateGroup.isPending}
						<Loader2 class="h-4 w-4 animate-spin" />
						กำลังบันทึก...
					{:else}
						บันทึก
					{/if}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={devicesOpen}>
		<Dialog.Content class="max-h-[90dvh] gap-5 overflow-y-auto rounded-2xl sm:max-w-[560px]">
			<Dialog.Header>
				<Dialog.Title class="text-lg font-bold text-slate-900">จัดการเครื่องในกลุ่ม</Dialog.Title>
				<Dialog.Description class="text-sm text-slate-500">
					ตู้ที่ติ๊กจะแสดงแบนเนอร์ของกลุ่ม {group.name} — ตู้ที่อยู่กลุ่มอื่นจะถูกย้ายมาที่นี่
				</Dialog.Description>
			</Dialog.Header>
			{#if devicesQuery.isLoading}
				<p class="py-8 text-center text-muted-foreground">กำลังโหลดรายการเครื่อง...</p>
			{:else if devicesQuery.error}
				<p class="py-8 text-center text-sm text-destructive">โหลดรายการเครื่องไม่สำเร็จ</p>
			{:else}
				<KioskBannerGroupDevicePicker {devices} {groups} groupId={group._id} bind:selected />
			{/if}
			<Dialog.Footer class="gap-2">
				<Button
					type="button"
					variant="outline"
					class="min-h-11"
					onclick={() => (devicesOpen = false)}
				>
					ยกเลิก
				</Button>
				<Button
					type="button"
					class="btn-primary-brand min-h-11 gap-2"
					disabled={setDevices.isPending || devicesQuery.isLoading}
					onclick={saveDevices}
				>
					{#if setDevices.isPending}
						<Loader2 class="h-4 w-4 animate-spin" />
						กำลังบันทึก...
					{:else}
						บันทึก
					{/if}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<AlertDialog.Root bind:open={deleteOpen}>
		<AlertDialog.Content class="max-w-md">
			<AlertDialog.Header>
				<div class="flex items-center gap-2 text-destructive">
					<TriangleAlert class="size-5 shrink-0" />
					<AlertDialog.Title>ลบกลุ่ม "{group.name}"?</AlertDialog.Title>
				</div>
				<AlertDialog.Description class="pt-2 text-sm">
					เครื่องในกลุ่มจะกลายเป็นไม่มีกลุ่มและไม่แสดงแบนเนอร์ —
					ลบได้เมื่อกลุ่มไม่มีแบนเนอร์เหลืออยู่ และย้อนกลับไม่ได้
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
				<AlertDialog.Action
					class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
					disabled={deleteGroup.isPending}
					onclick={confirmDelete}
				>
					ลบกลุ่ม
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
