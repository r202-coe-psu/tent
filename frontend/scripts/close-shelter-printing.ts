/**
 * Close a shelter's printing (O-11): every printer of the shelter goes inactive (open jobs fail
 * `printer_inactive`), then DB `printing_{code}` and its registry doc `printing_db:{CODE}` are
 * deleted. Immediate, idempotent, the same for `closed` and `cancelled` shelters. Run it as part of
 * the shelter-closing checklist until a closing flow calls `closeShelterPrinting` itself.
 *
 *   pnpm tsx --tsconfig .svelte-kit/tsconfig.json scripts/close-shelter-printing.ts SH001            # dry-run
 *   pnpm tsx --tsconfig .svelte-kit/tsconfig.json scripts/close-shelter-printing.ts SH001 --confirm
 *
 * Needs COUCHDB_ADMIN_URL (see printing-admin-client.ts). The steps and their order are shared
 * with the server via `$lib/server/printers/printing-close`.
 */
import { adminClosePorts, closeShelterPrintingWith } from '$lib/server/printers/printing-close';
import { loadAdminRaw } from './printing-admin-client';

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const [code] = args.filter((arg) => !arg.startsWith('--'));

if (!code) {
	console.error('usage: close-shelter-printing.ts <SHELTER_CODE> [--confirm]');
	process.exit(1);
}

const admin = loadAdminRaw();
const now = () => new Date();

try {
	const report = await closeShelterPrintingWith({ admin, ...adminClosePorts(admin, now) }, code, {
		dryRun: !confirm
	});
	const verb = report.dryRun ? 'would' : 'did';
	console.log(
		`shelter ${report.code} (${report.dryRun ? 'DRY-RUN, pass --confirm to apply' : 'CONFIRMED'})`
	);
	console.log(`  ${verb} deactivate ${report.printerIds.length} printer(s):`);
	for (const id of report.printerIds) console.log(`    ${id}`);
	console.log(`  ${verb} delete database ${report.db}`);
	console.log(`  ${verb} delete registry doc ${report.registryId} in printing_devices`);
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : 'close failed'}`);
	process.exit(1);
}
