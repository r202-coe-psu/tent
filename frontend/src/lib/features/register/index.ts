/** Public API of the `register` feature. */
export { registerSchema, type RegisterInput } from './domain/schema';
export { registerUser } from './data/register.api';
export { default as RegisterForm } from './ui/register-form.svelte';
