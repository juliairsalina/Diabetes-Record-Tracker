// Vercel serverless function for every /api/* request (see the rewrite in vercel.json).
'use strict';
const { createApp } = require('../lib/app.js');

const app = createApp();
module.exports = (req, res) => app.handle(req, res);
