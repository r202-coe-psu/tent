/**
 * System management → API Keys: SA manages a partner OAuth2 client end to end in the real UI,
 * and every step is checked against the partner plane itself (can the credentials mint a token?).
 *   create → the secret works · view secret needs the SA's password · generate a new secret →
 *   the old one stops working · edit scopes → the next token carries them · revoke → no new
 *   token · delete → gone from the list. A shelter manager cannot open the page.
 * EXT-001, ADR 0002 §6, CR-135, CR-154.
 *
 * UAT-142 (the CR-062 `/external/v1` key tab is hidden by CR-135, so the partner clients are
 * what SA manages on this page today)
 *
 * Video is off for this file: the reveal dialogs show a live secret. Screenshots are taken only
 * while no secret is on screen.
 */
import { shelterCodes } from '../../lib/env.ts';
import { adminClients, postToken, type PartnerClientMeta } from '../../lib/partner.ts';
import { checkpoint, expect, signIn, test } from '../fixtures.ts';
import type { Page } from '@playwright/test';

test.use({ video: 'off', trace: 'off' });

const PAGE = '/system-management/api-keys';
const RUN = Date.now().toString(36);
const NAME = `PERMTEST partner ui ${RUN}`;
const LOCATION_READ = 'location-read — Location Master (EXT-002/003)';
const STOCK_READ = 'location-stock-read — Shelter stock (EXT-004)';

const mintStatus = async (clientId: string, secret: string) =>
	(
		await postToken({
			grant_type: 'client_credentials',
			client_id: clientId,
			client_secret: secret
		})
	).status;

/** Read client id + secret from the reveal dialog, then close it before anything else runs. */
async function readReveal(page: Page): Promise<{ clientId: string; secret: string }> {
	const reveal = page.getByRole('dialog').filter({ hasText: 'Copy the client credentials' });
	await expect(reveal).toBeVisible();
	const values = reveal.locator('span.select-all');
	try {
		return {
			clientId: (await values.nth(0).innerText()).trim(),
			secret: (await values.nth(1).innerText()).trim()
		};
	} finally {
		await reveal.getByRole('button', { name: 'Done' }).click();
		await expect(reveal).toBeHidden();
	}
}

test.afterAll(async () => {
	// Whatever a failed run left behind: revoke, then soft-delete, by the run's name.
	const list = await adminClients<{ clients: PartnerClientMeta[] }>('GET');
	for (const c of list.body?.clients ?? []) {
		if (c.name !== NAME) continue;
		await adminClients('POST', `/${c.id}/revoke`);
		await adminClients('DELETE', `/${c.id}`);
	}
});

test('SA manages a partner client, and each step takes effect on the partner plane', async ({
	page,
	staffAccount
}, testInfo) => {
	test.setTimeout(180_000);
	const sa = await staffAccount('sa_tpc', ['system_admin'], 'ทดสอบ ผู้ดูแลระบบ');
	await signIn(page, sa);
	await page.goto(PAGE);
	await expect(page.getByRole('button', { name: 'Create client' }).first()).toBeVisible({
		timeout: 30_000
	});
	await checkpoint(page, testInfo, 'api-keys-page');

	// Create
	await page.getByRole('button', { name: 'Create client' }).first().click();
	const form = page.getByRole('dialog');
	await form.locator('#tpc-name').fill(NAME);
	await form.getByRole('checkbox', { name: LOCATION_READ, exact: true }).check();
	await checkpoint(page, testInfo, 'create-form');
	await form.getByRole('button', { name: 'Create client' }).click();
	const { clientId, secret } = await readReveal(page);
	expect(clientId).toMatch(/^tpc_/);
	const row = page.locator('tr', { hasText: clientId });
	await expect(row).toContainText(NAME);
	await expect(row.getByText('Active', { exact: true })).toBeVisible();
	await checkpoint(page, testInfo, 'created');
	expect(await mintStatus(clientId, secret), 'the new secret mints a token').toBe(200);

	// View secret: a wrong password shows nothing, the right one shows the same secret
	await row.getByRole('button', { name: 'View secret' }).click();
	const view = page.getByRole('dialog').filter({ hasText: 'View client secret' });
	await view.locator('#tpc-reveal-password').fill('permtest-wrong-password');
	await view.getByRole('button', { name: 'Reveal' }).click();
	await expect(view.locator('span.select-all')).toHaveCount(0);
	await expect(view.locator('#tpc-reveal-password')).toBeVisible();
	await checkpoint(page, testInfo, 'view-secret-wrong-password');
	await view.locator('#tpc-reveal-password').fill(sa.password);
	await view.getByRole('button', { name: 'Reveal' }).click();
	const shown = (await view.locator('span.select-all').innerText()).trim();
	await view.getByRole('button', { name: 'Done' }).click();
	expect(shown === secret, 'view secret shows the current secret').toBe(true);

	// Generate a new secret
	await row.getByRole('button', { name: 'Generate new secret' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Generate new secret' }).click();
	const regenerated = await readReveal(page);
	expect(regenerated.clientId).toBe(clientId);
	await expect(page.getByText('New secret generated')).toBeVisible();
	expect(await mintStatus(clientId, secret), 'the old secret is dead').toBe(401);
	expect(await mintStatus(clientId, regenerated.secret), 'the new secret works').toBe(200);

	// Edit scopes
	await row.getByRole('button', { name: 'Edit scopes' }).click();
	const edit = page.getByRole('dialog').filter({ hasText: 'Edit scopes' });
	await edit.getByRole('checkbox', { name: STOCK_READ, exact: true }).check();
	await checkpoint(page, testInfo, 'edit-scopes');
	await edit.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Scopes updated')).toBeVisible();
	await expect(row.getByText('location-stock-read', { exact: true })).toBeVisible();
	const minted = await postToken({
		grant_type: 'client_credentials',
		client_id: clientId,
		client_secret: regenerated.secret
	});
	expect(minted.body.scopes.slice().sort()).toEqual(['location-read', 'location-stock-read']);

	// Revoke
	await row.getByRole('button', { name: 'Revoke' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke client' }).click();
	await expect(page.getByText('Third-party client revoked')).toBeVisible();
	await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
	await expect(
		row.getByRole('button', { name: 'Edit scopes' }),
		'no edits once revoked'
	).toHaveCount(0);
	await checkpoint(page, testInfo, 'revoked');
	expect(await mintStatus(clientId, regenerated.secret), 'revoked: no new token').toBe(401);

	// Delete
	await row.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete client' }).click();
	await expect(page.getByText('Third-party client deleted')).toBeVisible();
	await expect(row).toHaveCount(0);
	await checkpoint(page, testInfo, 'deleted');
});

test('a shelter manager cannot open the API Keys page', async ({
	page,
	staffAccount
}, testInfo) => {
	const code = shelterCodes().a;
	const sm = await staffAccount('sm_tpc', [`shelter:${code}`, `${code}:shelter_manager`]);
	await signIn(page, sm);
	await page.goto(PAGE);
	await expect(page).toHaveURL(/\/portal$/);
	await expect(page.getByRole('button', { name: 'Create client' })).toHaveCount(0);
	await checkpoint(page, testInfo, 'sm-redirected');
});
