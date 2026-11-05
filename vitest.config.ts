import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { ADMIN_EMAILS: 'admin@neuron.test', PAPER_FETCH: 'off' },
  },
});
