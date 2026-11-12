/**
 * Fixture generator for scripts/tests/edge-repl-e2e.test.sh — writes the REAL design docs of the app to a
 * directory so the end-to-end test deploys the same validate_doc_update functions as production:
 *
 *   shelter_<code>.json     _design/access of a per-shelter DB (buildValidateDocUpdate, #1298 FR-6)
 *   registry_app.json       registry _design/app (buildRegistryDesignDoc, #1298 FR-7)
 *   catalog_access.json     catalog _design/access, extracted from syncCatalogAccessDesign (#1298 FR-7)
 *   sop_med.json            a valid daily_sop_role_assessment (role MED) with __CODE__ / __DATE__ / __USER__ / __TS__ placeholders
 *
 * Run from frontend/ so the `$lib` alias resolves:  cd frontend && ./node_modules/.bin/tsx ../scripts/tests/edge-repl-e2e.gen.ts <outdir> <CODE>...
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildValidateDocUpdate } from '../../frontend/src/lib/server/shelter-access-design.ts';
import { buildRegistryDesignDoc } from '../../frontend/src/lib/server/registry-design.ts';
import {
	DAILY_SOP_ROLES,
	DAILY_SOP_ROLE_QUESTIONS,
	DAILY_SOP_ROLE_QUESTION_VERSION
} from '../../frontend/src/lib/features/daily-sop/server.ts';

const [outDir, ...codes] = process.argv.slice(2);
if (!outDir || codes.length === 0) {
	console.error('usage: edge-repl-e2e.gen.ts <outdir> <CODE>...');
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const write = (name: string, value: unknown) =>
	writeFileSync(join(outDir, name), JSON.stringify(value));

for (const code of codes) {
	write(`shelter_${code.toLowerCase()}.json`, {
		_id: '_design/access',
		validate_doc_update: buildValidateDocUpdate(code)
	});
}
write('registry_app.json', buildRegistryDesignDoc());

// The catalog VDU only exists as a template literal inside the maintenance script: evaluate that literal.
const src = readFileSync(new URL('../../frontend/scripts/sync-central-db.ts', import.meta.url), 'utf8');
const startMarker = 'const validateFn = `';
const start = src.indexOf(startMarker) + startMarker.length;
const end = src.indexOf('\n}`;', start) + 2;
if (start < startMarker.length || end < start) throw new Error('catalog validateFn not found in sync-central-db.ts');
const raw = src.slice(start, end);
if (raw.includes('${')) throw new Error('catalog validateFn now interpolates — extend the generator');
write('catalog_access.json', {
	_id: '_design/access',
	validate_doc_update: new Function('return `' + raw + '`')() as string
});

// MED (medical_staff) has no metric questions, so a control is just {id, question, status, ...}.
const role = DAILY_SOP_ROLES.find((r) => r.code === 'MED');
if (!role) throw new Error('role MED not found');
const questions = DAILY_SOP_ROLE_QUESTIONS.filter((q) => q.role === role.code);
write('sop_med.json', {
	_id: `daily_sop_role_assessment:__CODE__:__DATE__:${role.code}`,
	type: 'daily_sop_role_assessment',
	schema_v: 1,
	shelter_code: '__CODE__',
	assessment_date: '__DATE__',
	role_code: role.code,
	role_key: role.key,
	role_label: role.label,
	question_set_version: DAILY_SOP_ROLE_QUESTION_VERSION,
	assessed_at: '__TS__',
	assessor_name: '__USER__',
	status: 'Completed',
	pass_count: questions.length,
	fail_count: 0,
	pending_count: 0,
	unanswered_count: 0,
	controls: questions.map((q) => ({
		id: q.id,
		question: q.text,
		metric_spec: null,
		status: 'Pass',
		notes: '',
		observations: '',
		measured_values: {},
		checked_by: '__USER__',
		checked_at: '__TS__'
	})),
	created_at: '__TS__',
	updated_at: '__TS__',
	created_by: '__USER__'
});
