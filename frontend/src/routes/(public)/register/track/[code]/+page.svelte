<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import PackageSearch from '@lucide/svelte/icons/package-search';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { BookingTicket, useBookingLookup } from '$lib/features/public-register';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	const lookup = useBookingLookup();

	let phone = $state('');
	let errorMessage = $state('');

	const ticket = $derived(lookup.data ?? null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = '';

		if (!phone.trim()) {
			errorMessage = 'กรุณากรอกเบอร์โทรศัพท์ที่ใช้ตอนจอง';
			return;
		}

		try {
			await lookup.mutateAsync({ code: data.code, phone: phone.trim() });
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'ตรวจสอบสถานะไม่สำเร็จ';
			toast.error(errorMessage);
		}
	}
</script>

<svelte:head>
	<title>สถานะการจอง — Smart Shelter</title>
</svelte:head>

<PublicPageShell class="space-y-6">
	<div class="mx-auto w-full max-w-md space-y-6">
		<div class="text-center">
			<div
				class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-muted text-primary"
			>
				<PackageSearch class="h-6 w-6" />
			</div>
			<h1 class="mt-3 text-xl font-bold text-foreground">สถานะการจอง</h1>
			<p class="mt-1 font-mono text-xs break-all text-muted-foreground">{data.code}</p>
		</div>

		{#if !ticket}
			<form
				onsubmit={submit}
				class="space-y-4 rounded-2xl border border-black/[0.04] bg-card p-5 shadow-sm"
			>
				<div class="space-y-2">
					<Label for="booking-phone">เบอร์โทรศัพท์ที่ใช้ตอนจอง</Label>
					<Input
						id="booking-phone"
						bind:value={phone}
						inputmode="numeric"
						maxlength={10}
						placeholder="0812345678"
						autocomplete="tel"
					/>
				</div>

				{#if errorMessage}
					<p
						class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
						role="alert"
					>
						{errorMessage}
					</p>
				{/if}

				<Button type="submit" class="w-full" disabled={lookup.isPending}>
					{lookup.isPending ? 'กำลังตรวจสอบ…' : 'ดูสถานะการจอง'}
				</Button>

				<p class="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
					<Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span>
						รหัสการจองเพียงอย่างเดียวเปิดดูข้อมูลไม่ได้ ต้องยืนยันด้วยเบอร์โทรที่ตรงกันเสมอ
					</span>
				</p>
			</form>
		{:else}
			<BookingTicket {ticket} showSuccessHeader={false} />
		{/if}
	</div>
</PublicPageShell>
