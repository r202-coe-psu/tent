import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default ts.config(
	includeIgnoreFile(gitignorePath),
	// Vendored shadcn-svelte primitives — generated, not hand-maintained.
	{ ignores: ['src/lib/components/ui/**'] },
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
			// Enforce feature encapsulation: import a feature only via its barrel
			// ($lib/features/<x>), never reach into its internal layers.
			'no-restricted-imports': [
				'error',
				{
					patterns: [
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
					]
				}
			]
		}
	},
	{
		// A feature may freely import its own internals; the barrel rule only
		// guards cross-feature/route access.
		files: ['src/lib/features/**'],
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
