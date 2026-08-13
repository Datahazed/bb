#!/usr/bin/env node

import { serveProviderDriverProcess } from "@bb/provider-driver-sdk";
import { piProviderDriver } from "./driver.js";

serveProviderDriverProcess(piProviderDriver, {
  onFatalError: (error) => {
    process.stderr.write(`pi driver fatal: ${error.message}\n`);
  },
});
