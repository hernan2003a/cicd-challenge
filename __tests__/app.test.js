const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  let originalEnv;
  let originalVersion;

  beforeAll(() => {
    originalEnv = process.env.APP_ENV;
    originalVersion = process.env.APP_VERSION;
  });

  afterAll(() => {
    process.env.APP_ENV = originalEnv;
    process.env.APP_VERSION = originalVersion;
  });

  it('should return 200 and status ok when APP_ENV is set', async () => {
    process.env.APP_ENV = 'test';
    process.env.APP_VERSION = 'test-build';
    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.env).toBe('test');
    expect(response.body.version).toBe('test-build');
  });

  it('should return an unknown version when APP_VERSION is not set', async () => {
    process.env.APP_ENV = 'test';
    delete process.env.APP_VERSION;

    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.version).toBe('unknown');
  });

  it('should return 500 when APP_ENV is not set', async () => {
    delete process.env.APP_ENV;
    process.env.APP_VERSION = 'degraded-build';
    const response = await request(app).get('/health');

    expect(response.statusCode).toBe(500);
    expect(response.body.status).toBe('degraded');
    expect(response.body.version).toBe('degraded-build');
  });
});
