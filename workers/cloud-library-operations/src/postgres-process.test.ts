// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { postgresConnectionEnvironment } from '../../../scripts/cloud-library-postgres-process.mjs';

describe('explicit PostgreSQL connection boundaries', () => {
  it.each(['database', 'user', 'projectRef'])('rejects missing and non-string %s before libpq can choose defaults', field => {
    for (const value of [undefined, null, 123]) {
      const connection = { host: '127.0.0.1', port: 5432, database: 'fixture', user: 'fixture', password: '', sslMode: 'disable', projectRef: 'synthetic-source', [field]: value };
      let refused = false;
      try { postgresConnectionEnvironment(connection); } catch { refused = true; }
      // Never include the returned environment in a failing diagnostic.
      expect(refused).toBe(true);
    }
  });
});
