#!/usr/bin/env node

import { dispatch } from "../src/dispatcher.mjs";

const result = dispatch({ argv: process.argv.slice(2) });
if (result.message) process.stderr.write(`${result.message}\n`);
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.exitCode;
