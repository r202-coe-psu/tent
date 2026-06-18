<script lang="ts">
	import { toast } from 'svelte-sonner';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import Building from '@lucide/svelte/icons/building';
	import Plus from '@lucide/svelte/icons/plus';
	import {
		CreateShelterForm,
		useShelters,
		useCreateShelter,
		type CreateShelterInput
	} from '$lib/features/shelters';

	const sheltersQuery = useShelters();
	const createMutation = useCreateShelter();

	function handleCreate(input: CreateShelterInput) {
		createMutation.mutate(input, {
			onSuccess: (res) => toast.success(`Shelter "${res.code}" provisioned`),
			onError: (err: Error) => toast.error(err.message)
		});
	}
</script>

<svelte:head>
	<title>ตั้งค่าศูนย์พักพิง · SmartShelter</title>
</svelte:head>

<header class="flex shrink-0 items-center gap-2 border-b border-sidebar-border bg-card px-4 py-2.5">
	<Building class="h-4 w-4 text-primary" />
	<h1 class="text-base font-bold text-foreground">ตั้งค่าศูนย์พักพิง</h1>
</header>

<div class="flex w-full flex-1 flex-col gap-4 p-4">
	<div class="flex flex-col gap-1 border-l-4 border-primary pl-3">
		<h2 class="text-sm font-bold text-foreground">จัดการโครงสร้างศูนย์พักพิง</h2>
	</div>

	<Card.Root>
		<Card.Header>
			<div class="flex items-center gap-2">
				<Plus class="h-4 w-4 text-primary" />
				<Card.Title class="text-sm">เพิ่มศูนย์พักพิงใหม่</Card.Title>
			</div>
			<Card.Description class="text-xs"
				>สร้างฐานข้อมูล, กำหนดสิทธิ์, และลงทะเบียนศูนย์ในระบบ</Card.Description
			>
		</Card.Header>
		<Card.Content>
			<CreateShelterForm onsubmit={handleCreate} pending={createMutation.isPending} />
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<div class="flex items-center gap-2">
				<Building class="h-4 w-4 text-primary" />
				<Card.Title class="text-sm">ศูนย์พักพิงในระบบ</Card.Title>
			</div>
		</Card.Header>
		<Card.Content>
			{#if sheltersQuery.isLoading}
				<p class="text-sm text-muted-foreground">Loading...</p>
			{:else if sheltersQuery.isError}
				<p class="text-sm text-destructive">Error: {sheltersQuery.error?.message}</p>
			{:else if (sheltersQuery.data ?? []).length === 0}
				<p class="text-sm text-muted-foreground">ยังไม่มีศูนย์พักพิงในระบบ</p>
			{:else}
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>รหัส</Table.Head>
								<Table.Head>ชื่อศูนย์</Table.Head>
								<Table.Head>ฐานข้อมูล</Table.Head>
								<Table.Head>สถานะ</Table.Head>
								<Table.Head>โซน</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each sheltersQuery.data ?? [] as shelter (shelter.code)}
								<Table.Row>
									<Table.Cell class="font-mono font-bold text-foreground">{shelter.code}</Table.Cell
									>
									<Table.Cell>{shelter.name}</Table.Cell>
									<Table.Cell class="font-mono text-xs text-muted-foreground"
										>{shelter.db}</Table.Cell
									>
									<Table.Cell>
										<span
											class="rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700"
											>{shelter.status}</span
										>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">
										{shelter.zones.length > 0 ? shelter.zones.map((z) => z.name).join(', ') : '—'}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
