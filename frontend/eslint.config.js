import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

// Enforce feature encapsulation: import a feature only via its barrel
// ($lib/features/<x>), never reach into its internal layers.
const featureBarrelPatterns = [
	{
		group: [
			'$lib/features/*/domain/*',
			'$lib/features/*/data/*',
			'$lib/features/*/application/*',
			'$lib/features/*/ui/*'
		],
		message:
			'Import from the feature barrel ($lib/features/<feature>) instead of reaching into its internal layers.'
	}
];

const printerAdminImportMessage =
	'Printer code must not import `$lib/server/couch-admin` (the CouchDB server admin): go through `printing_service` (`$lib/server/couch-printing-service`), the caller session (`$lib/server/couch-as-user`), or the credential-free helpers in `$lib/server/session-auth`. Only printing-provision.ts provisions databases.';

export default ts.config(
	includeIgnoreFile(gitignorePath),
	// Vendored shadcn-svelte primitives — generated, not hand-maintained.
	{ ignores: ['src/lib/components/ui/**', 'static/**'] },
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'svelte/no-navigation-without-resolve': 'off',
			// Prefer typography tokens over arbitrary px font sizes (text-[Npx]).
			'no-restricted-syntax': [
				'warn',
				{
					selector: 'Literal[value=/text-\\[\\d+px\\]/]',
					message:
						'Use typography tokens (text-3xs, text-2xs, text-xs, text-sm, text-base, text-lg, text-xl) instead of text-[Npx].'
				}
			],
			'no-restricted-imports': ['error', { patterns: featureBarrelPatterns }]
		}
	},
	{
		// A feature may freely import its own internals; the barrel rule only
		// guards cross-feature/route access.
		files: ['src/lib/features/**', 'scripts/**'],
		rules: { 'no-restricted-imports': 'off' }
	},
	{
		// Print-server least privilege (plan §4.5, CR-222 FR-2a): printer code runs as `printing_service`,
		// never the CouchDB server admin, so it must not import `$lib/server/couch-admin` at all. The
		// credential-free helpers (`ServiceError`, `readSessionUserCtx`, `requireShelterScopeOrSA`) live in
		// `$lib/server/session-auth`. Only `printing-provision.ts` may hold the admin client (creating /
		// deleting a database needs the server admin); routes reach it through that module. Same rule as the
		// global block, so the feature-barrel patterns are repeated here instead of being overridden.
		files: [
			'src/lib/server/printers/**',
			'src/routes/api/v1/printer/**',
			'src/routes/api/staff/v1/printers/**',
			'src/routes/api/staff/v1/print-jobs/**',
			'src/routes/api/back-office/printers/**',
			'src/routes/api/internal/printers/**'
		],
		ignores: ['src/lib/server/printers/printing-provision.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [{ name: '$lib/server/couch-admin', message: printerAdminImportMessage }],
					// `paths` only matches the exact `$lib/server/couch-admin` specifier; the group also
					// catches relative spellings (`../couch-admin`, `../../server/couch-admin`).
					patterns: [
						...featureBarrelPatterns,
						{ group: ['**/couch-admin', '**/couch-admin.*'], message: printerAdminImportMessage }
					]
				}
			]
		}
	},
	{
		// Whole-package lucide imports pull every icon module into the graph (slow
		// dev/test/build). Deep-import per icon instead. Separate block + the
		// @typescript-eslint rule so it also applies inside `src/lib/features/**`
		// (where the core `no-restricted-imports` barrel rule is off) and so the
		// two rules never override each other.
		files: ['src/**'],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					paths: ['@lucide/svelte', '@lucide/svelte/icons'].map((name) => ({
						name,
						allowTypeImports: true,
						message:
							"Import icons one-by-one: `import Foo from '@lucide/svelte/icons/<kebab-name>';` (whole-package imports bloat the module graph)."
					}))
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
