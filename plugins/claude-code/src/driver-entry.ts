#!/usr/bin/env node

import { serveProviderDriverProcess } from "@bb/provider-driver-sdk";
import { claudeCodeProviderDriver } from "./driver.js";

serveProviderDriverProcess(claudeCodeProviderDriver, {
  onFatalError(error) {
    process.stderr.write(`claude-code driver fatal error: ${error.message}\n`);
  },
});
