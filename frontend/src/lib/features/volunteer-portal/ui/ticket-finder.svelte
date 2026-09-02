<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Search from '@lucide/svelte/icons/search';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input';
	import { useFindTicketsMutation } from '../application/queries';
	import { ticketFindSchema, ticketStatusLabel } from '../domain/volunteer';

	let phone = $state('');
	let error = $state('');
	let searched = $state(false);

	const find = useFindTicketsMutation();
	const tickets = $derived(find.data?.tickets ?? []);

	async function search(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const parsed = ticketFindSchema.safeParse({ phone });
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'เบอร์โทรศัพท์ไม่ถูกต้อง';
			return;
		}
		try {
			await find.mutateAsync(parsed.data.phone);
			searched = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'ค้นหาตั๋วไม่สำเร็จ';
		}
	}
</script>

<div class="mx-auto max-w-xl space-y-4">
	<form onsubmit={search} class="flex gap-2">
		<Input
			bind:value={phone}
			inputmode="tel"
			placeholder="กรอกเบอร์โทรศัพท์ที่ใช้สมัคร"
			aria-label="เบอร์โทรศัพท์"
		/>
		<Button type="submit" disabled={find.isPending}>
			{#if find.isPending}
				<Loader2 class="size-4 animate-spin" aria-hidden="true" />
			{:else}
				<Search class="size-4" aria-hidden="true" />
			{/if}
			<span class="ml-2">ค้นหา</span>
		</Button>
	</form>

	{#if error}
		<p class="text-sm text-destructive" role="alert">{error}</p>
	{/if}

	{#if searched && tickets.length === 0}
		<Card.Root>
			<Card.Content class="py-8 text-center text-sm text-muted-foreground">
				ไม่พบตั๋วสำหรับเบอร์นี้ หากเพิ่งสมัคร กรุณาเปิดจากลิงก์ตั๋วที่ได้รับ
			</Card.Content>
		</Card.Root>
	{/if}

	{#each tickets as ticket (ticket.view_token)}
		<Card.Root>
			<Card.Header>
				<div class="flex items-start justify-between gap-2">
					<Card.Title class="text-base">{ticket.job_title || 'งานอาสาสมัคร'}</Card.Title>
					<Badge variant={ticket.status === 'confirmed' ? 'default' : 'secondary'}>
						{ticketStatusLabel(ticket.status)}
					</Badge>
				</div>
				<Card.Description>
					{ticket.shelter_code}{ticket.shift_date ? ` · ${ticket.shift_date}` : ''}
				</Card.Description>
			</Card.Header>
			<Card.Footer class="flex-col items-stretch gap-2">
				<Button href="/volunteer/ticket/{ticket.view_token}" variant="outline" class="w-full">
					เปิดตั๋วดิจิทัล
				</Button>
				<!--
					Reached by phone number, so this opens the pass read-only. Cancelling needs the
					ticket link the applicant was given when they applied — a phone number is
					guessable and a withdrawn shift cannot be taken back.
				-->
				<p class="text-xs text-muted-foreground">
					เปิดจากการค้นด้วยเบอร์โทร — ดูได้อย่างเดียว หากต้องการยกเลิก ใช้ลิงก์ตั๋วที่ได้รับตอนสมัคร
				</p>
			</Card.Footer>
		</Card.Root>
	{/each}
</div>
