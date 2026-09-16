<script lang="ts">
	import {
		useAnnouncements,
		useCreateAnnouncement,
		useUpdateAnnouncement,
		useDeleteAnnouncement
	} from '$lib/features/announcements';
	import type { Announcement } from '$lib/features/announcements';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import { Switch } from '$lib/components/ui/switch';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Info from '@lucide/svelte/icons/info';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import { toast } from 'svelte-sonner';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { ADMIN_ANNOUNCEMENTS_I18N } from '$lib/constants/i18n';

	const t = $derived(getTranslation(ADMIN_ANNOUNCEMENTS_I18N, langState.current));

	const announcementsQuery = useAnnouncements();
	const createAnnouncementMutation = useCreateAnnouncement();
	const updateAnnouncementMutation = useUpdateAnnouncement();
	const deleteAnnouncementMutation = useDeleteAnnouncement();

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let isDialogOpen = $state(false);
	let editingId = $state<string | null>(null);

	const defaultForm = () => ({
		title: '',
		description: '',
		title_en: '',
		description_en: '',
		severity: 'info' as 'info' | 'warning' | 'emergency',
		is_active: true
	});
	let form = $state(defaultForm());

	const announcements = $derived(announcementsQuery.data ?? []);
	const total = $derived(announcements.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const clampedPage = $derived(Math.max(1, Math.min(currentPage, totalPages)));
	const pageAnnouncements = $derived(
		announcements.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)
	);

	$effect(() => {
		const normalizedPage = Math.max(1, Math.min(currentPage, totalPages));
		if (currentPage !== normalizedPage) currentPage = normalizedPage;
	});

	const isSaving = $derived(
		createAnnouncementMutation.isPending || updateAnnouncementMutation.isPending
	);

	function openCreateDialog() {
		editingId = null;
		form = defaultForm();
		isDialogOpen = true;
	}

	function openEditDialog(item: Announcement) {
		editingId = item._id;
		form = {
			title: item.title,
			description: item.description,
			title_en: item.title_en || '',
			description_en: item.description_en || '',
			severity: item.severity,
			is_active: item.is_active
		};
		isDialogOpen = true;
	}

	function handleSave() {
		if (!form.title.trim() || !form.description.trim()) {
			toast.error('กรุณาระบุหัวข้อและรายละเอียด');
			return;
		}

		if (editingId) {
			updateAnnouncementMutation.mutate(
				{ id: editingId, data: form },
				{
					onSuccess: () => {
						toast.success('อัปเดตประกาศสำเร็จ');
						isDialogOpen = false;
					}
				}
			);
		} else {
			createAnnouncementMutation.mutate(form, {
				onSuccess: () => {
					toast.success('สร้างประกาศสำเร็จ');
					isDialogOpen = false;
				}
			});
		}
	}

	function handleDelete(id: string) {
		if (confirm('ยืนยันการลบประกาศนี้?')) {
			deleteAnnouncementMutation.mutate(id, {
				onSuccess: () => {
					toast.success('ลบประกาศสำเร็จ');
				}
			});
		}
	}

	function toggleActive(id: string, current: boolean) {
		updateAnnouncementMutation.mutate({
			id,
			data: { is_active: !current }
		});
	}

	const severityConfig = {
		info: {
			color: 'bg-blue-50 text-blue-700 border-blue-200',
			icon: Info,
			label: 'ทั่วไป (Info)'
		},
		warning: {
			color: 'bg-amber-50 text-amber-700 border-amber-200',
			icon: AlertTriangle,
			label: 'แจ้งเตือน (Warning)'
		},
		emergency: {
			color: 'bg-red-50 text-red-700 border-red-200',
			icon: AlertOctagon,
			label: 'ฉุกเฉิน (Emergency)'
		}
	};
</script>

<svelte:head>
	<title>{t.pageTitle} — SmartShelter</title>
</svelte:head>

<div class="mx-6 flex flex-1 flex-col gap-8 p-6 md:p-8">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
		<div>
			<h2 class="text-3xl font-bold tracking-tight text-foreground">{t.pageTitle}</h2>
			<p class="mt-2 text-muted-foreground">
				จัดการข้อความประกาศแจ้งเตือนที่จะเผยแพร่บนระบบสาธารณะ
				เพื่อให้ประชาชนได้รับทราบข้อมูลที่สำคัญ
			</p>
		</div>
		<Button
			onclick={openCreateDialog}
			class="shrink-0 bg-primary text-primary-foreground shadow-md transition-all hover:bg-primary/90"
		>
			<Plus class="mr-2 h-4 w-4" />
			สร้างประกาศใหม่
		</Button>
	</div>

	<div class="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
		<Table.Root class="w-full table-fixed">
			<Table.Header class="bg-muted/50">
				<Table.Row class="hover:bg-transparent">
					<Table.Head class="w-[55%] font-semibold text-foreground md:w-[60%] lg:w-[60%]"
						>{t.tableHeaderTitle}</Table.Head
					>
					<Table.Head class="w-[15%] font-semibold text-foreground md:w-[15%] lg:w-[15%]"
						>{t.tableHeaderSeverity}</Table.Head
					>
					<Table.Head
						class="w-[15%] text-center font-semibold text-foreground md:w-[15%] lg:w-[15%]"
						>{t.tableHeaderStatus}</Table.Head
					>
					<Table.Head class="w-[15%] text-right font-semibold text-foreground md:w-[10%] lg:w-[10%]"
						>{t.tableHeaderActions}</Table.Head
					>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if announcementsQuery.isLoading}
					<Table.Row>
						<Table.Cell colspan={5} class="h-48 text-center">
							<div class="flex flex-col items-center justify-center gap-3 text-muted-foreground">
								<div
									class="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
								></div>
								<p>{t.loading}</p>
							</div>
						</Table.Cell>
					</Table.Row>
				{:else if announcementsQuery.data?.length === 0}
					<Table.Row>
						<Table.Cell colspan={5} class="h-64 text-center">
							<div class="flex flex-col items-center justify-center gap-4 text-muted-foreground">
								<div class="rounded-full bg-muted p-4">
									<Info class="h-8 w-8" />
								</div>
								<div>
									<h3 class="text-lg font-semibold text-foreground">{t.emptyTitle}</h3>
									<p class="mt-1 text-sm">{t.emptyDesc}</p>
								</div>
								<Button variant="outline" class="mt-2" onclick={openCreateDialog}>
									<Plus class="mr-2 h-4 w-4" />
									{t.createNewBtn}
								</Button>
							</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each pageAnnouncements as item (item._id)}
						{@const config = severityConfig[item.severity]}
						{@const Icon = config.icon}
						<Table.Row class="group transition-colors hover:bg-muted/30">
							<Table.Cell class="py-5 pr-4 align-middle">
								<div
									class="flex min-w-0 flex-col gap-1.5 {item.is_active
										? ''
										: 'opacity-60'} overflow-hidden"
								>
									<span
										class="truncate text-base leading-tight font-semibold text-foreground"
										title={item.title}
									>
										{item.title}
									</span>
									<div
										class="line-clamp-4 text-sm leading-relaxed break-words text-muted-foreground"
										title={item.description}
									>
										{item.description}
									</div>
								</div>
							</Table.Cell>
							<Table.Cell class="py-5 align-middle">
								<span
									class="inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold shadow-sm md:text-xs {config.color} {item.is_active
										? ''
										: 'opacity-60'}"
								>
									<Icon class="h-3 w-3 shrink-0 md:h-3.5 md:w-3.5" />
									<span class="hidden md:inline">{config.label}</span>
									<span class="md:hidden">{config.label.split(' ')[0]}</span>
								</span>
							</Table.Cell>

							<Table.Cell class="py-5 text-center align-middle">
								<div class="flex flex-col items-center gap-1.5">
									<Switch
										id="active-{item._id}"
										checked={item.is_active}
										onCheckedChange={() => toggleActive(item._id, item.is_active)}
									/>
									<span
										class="hidden text-2xs font-medium lg:inline-block {item.is_active
											? 'text-primary'
											: 'text-muted-foreground'}"
									>
										{item.is_active ? t.statusActive : t.statusHidden}
									</span>
								</div>
							</Table.Cell>
							<Table.Cell class="py-5 text-right align-middle">
								<div class="flex items-center justify-end gap-2">
									<Button
										variant="ghost"
										size="icon"
										class="size-10 rounded-xl bg-white shadow"
										onclick={() => openEditDialog(item)}
										aria-label="Edit announcement"
									>
										<Pencil class="size-5 text-muted-foreground hover:text-foreground" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										class="size-10 rounded-xl bg-white shadow"
										onclick={() => handleDelete(item._id)}
										aria-label="Delete announcement"
									>
										<Trash2 class="size-5 text-destructive" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>

		{#if totalPages > 1}
			<div class="mt-2 flex justify-center border-t border-border/60 bg-muted/20 py-4">
				<Pagination.Root
					bind:page={() => clampedPage, (p) => (currentPage = p)}
					count={total}
					perPage={PAGE_SIZE}
				>
					{#snippet children({ pages })}
						<Pagination.Content>
							<Pagination.Previous />
							{#each pages as p (p.key)}
								<Pagination.Item>
									{#if p.type === 'page'}
										<Pagination.Link page={p} isActive={p.value === clampedPage} />
									{:else}
										<Pagination.Ellipsis />
									{/if}
								</Pagination.Item>
							{/each}
							<Pagination.Next />
						</Pagination.Content>
					{/snippet}
				</Pagination.Root>
			</div>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={isDialogOpen}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[500px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl"
				>{editingId ? t.dialogEditTitle : t.dialogCreateTitle}</Dialog.Title
			>
			<Dialog.Description class="mt-1.5">
				{t.dialogDesc}
			</Dialog.Description>
		</div>
		<div class="grid gap-5 p-6">
			<div class="grid gap-2">
				<Label for="title" class="text-sm font-semibold"
					>{t.formTitleTh} <span class="text-destructive">*</span></Label
				>
				<Input
					id="title"
					bind:value={form.title}
					placeholder={t.formTitleThPlaceholder}
					class="focus-visible:ring-primary"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="description" class="text-sm font-semibold"
					>{t.formDescTh} <span class="text-destructive">*</span></Label
				>
				<Textarea
					id="description"
					bind:value={form.description}
					placeholder={t.formDescThPlaceholder}
					rows={4}
					class="resize-none focus-visible:ring-primary"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="title_en" class="text-sm font-semibold">{t.formTitleEn}</Label>
				<Input
					id="title_en"
					bind:value={form.title_en}
					placeholder="e.g. Storm warning at shelter area"
					class="focus-visible:ring-primary"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="description_en" class="text-sm font-semibold">{t.formDescEn}</Label>
				<Textarea
					id="description_en"
					bind:value={form.description_en}
					placeholder="Announcement description in English..."
					rows={4}
					class="resize-none focus-visible:ring-primary"
				/>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="severity" class="text-sm font-semibold">{t.formSeverity}</Label>
					<Select.Root
						type="single"
						value={form.severity}
						onValueChange={(v) => (form.severity = v as 'info' | 'warning' | 'emergency')}
					>
						<Select.Trigger class="w-full">
							{severityConfig[form.severity].label}
						</Select.Trigger>
						<Select.Content>
							{#each Object.entries(severityConfig) as [key, config] (key)}
								{@const Icon = config.icon}
								<Select.Item value={key}>
									<div class="flex items-center gap-2">
										<Icon class="h-4 w-4" />
										{config.label}
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="grid gap-2">
					<Label for="is-active" class="text-sm font-semibold">{t.formStatus}</Label>
					<div
						class="flex h-10 items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 shadow-sm"
					>
						<span class="text-sm">{form.is_active ? t.formStatusActive : t.formStatusDraft}</span>
						<Switch id="is-active" bind:checked={form.is_active} />
					</div>
				</div>
			</div>
		</div>
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button variant="ghost" onclick={() => (isDialogOpen = false)}>{t.btnCancel}</Button>
			<Button onclick={handleSave} disabled={isSaving} class="min-w-[100px]">
				{#if isSaving}
					<div
						class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
					></div>
					กำลังบันทึก...
				{:else}
					บันทึกประกาศ
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
