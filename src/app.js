const express = require('express');

const app = express();

app.get('/health', (_req, res) => {
  const envReady = Boolean(process.env.APP_ENV);
  const version = process.env.APP_VERSION || 'unknown';

  if (!envReady) {
    return res.status(500).json({
      status: 'degraded',
      reason: 'APP_ENV is missing',
      version
    });
  }

  return res.status(200).json({
    status: 'ok',
    env: process.env.APP_ENV,
    version
  });
});

module.exports = app;
