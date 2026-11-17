'use strict';
const { handleRequest } = require('../../../stcine-web-api/src/server');
module.exports = async function handler(req, res) { return handleRequest(req, res); };
