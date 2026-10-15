import tseslint from 'typescript-eslint';

export default tseslint.config(
  {ignores:['**/dist/**','**/node_modules/**','**/coverage/**','**/uploads/**']},
  ...tseslint.configs.recommended,
  {files:['**/*.{ts,tsx}'],rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':'off','@typescript-eslint/no-namespace':'off','no-constant-condition':'off'}}
);
