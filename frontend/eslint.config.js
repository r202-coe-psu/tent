import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

/**
 * Reaching past a feature's barrel into the files behind it.
 *
 * `components/*` is in the list because it is where the guard used to leak: a couple of
 * features grew a `components/` folder outside the four documented layers, and since
 * the pattern list named only those four, anything in there was importable from
 * anywhere with no error at all.
 */
const featureInternals = {
	group: [
		'$lib/features/*/domain/*',
		'$lib/features/*/data/*',
		'$lib/features/*/application/*',
		'$lib/features/*/ui/*',
		'$lib/features/*/components/*'
	],
	message:
		'Import from the feature barrel ($lib/features/<feature>) instead of reaching into its internal layers.'
};

/** Forbid one feature outright — its barrel included, not just its internals. */
const wholeFeature = (name, message) => ({
	group: [`$lib/features/${name}`, `$lib/features/${name}/**`],
	message
});

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
			// Enforce feature encapsulation: import a feature only via its barrel
			// ($lib/features/<x>), never reach into its internal layers.
			'no-restricted-imports': ['error', { patterns: [featureInternals] }]
		}
	},
	{
		// A feature may freely import its own internals; the barrel rule only
		// guards cross-feature/route access.
		files: ['src/lib/features/**', 'scripts/**'],
		rules: { 'no-restricted-imports': 'off' }
	},
	{
		/*
		 * The two volunteer slices are a hard boundary, not a convention.
		 *
		 * `volunteer-portal` serves anonymous volunteers out of projected public data;
		 * `volunteers` is the staff-side system of record. They share no code by design
		 * (see `features/volunteer-portal/index.ts`), but the blanket off-switch above
		 * disables the barrel rule inside every feature — so a reach across the line
		 * linted clean, and a change on one side broke the other team's screen.
		 *
		 * So: turn the rule back on for these two, and forbid the opposite slice
		 * outright — barrel included, because "share no code" means none. If they ever
		 * genuinely need the same component, it belongs in `features/shared`, owned by
		 * neither, rather than imported out of the other's internals.
		 */
		files: ['src/lib/features/volunteer-portal/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						featureInternals,
						wholeFeature(
							'volunteers',
							'volunteer-portal must not import the staff `volunteers` slice (public plane vs system of record). Duplicate what you need here, or extract it to $lib/features/shared.'
						)
					]
				}
			]
		}
	},
	{
		files: ['src/lib/features/volunteers/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						featureInternals,
						wholeFeature(
							'volunteer-portal',
							'The staff `volunteers` slice must not import the public `volunteer-portal` slice. Extract shared code to $lib/features/shared instead.'
						)
					]
				}
			]
		}
	},
	{
		/*
		 * The legacy public job board, predating CR-104's single Job Board model — a
		 * second implementation of the same screen that still reaches into the staff
		 * slice's `components/`, and one of the two imports the widened pattern above
		 * now catches.
		 *
		 * Exempted rather than fixed because consolidating the two boards changes scope
		 * and retires an endpoint, which needs a CR first. Kept here instead of as a
		 * disable comment in the page so the file itself needs no edit while the other
		 * team is working in it.
		 *
		 * Remove this block together with the legacy board.
		 */
		files: ['src/routes/**/volunteers/jobs/+page.svelte'],
		rules: { 'no-restricted-imports': 'off' }
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
