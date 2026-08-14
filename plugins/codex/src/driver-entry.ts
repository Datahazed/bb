#!/usr/bin/env node

import { serveProviderDriverProcess } from "@bb/provider-driver-sdk";
import { codexProviderDriver } from "./driver.js";

serveProviderDriverProcess(codexProviderDriver, {
  onFatalError: (error) => {
    process.stderr.write(`codex driver fatal: ${error.message}\n`);
  },
});
