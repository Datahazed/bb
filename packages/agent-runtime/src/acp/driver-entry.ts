#!/usr/bin/env node

import { serveProviderDriverProcess } from "@bb/provider-driver-sdk";
import {
  acpProviderDriver,
  isAcpMcpStdioProcess,
  runAcpMcpStdioProcess,
} from "./driver.js";

if (isAcpMcpStdioProcess()) {
  runAcpMcpStdioProcess();
  process.on("uncaughtException", (error) => {
    process.stderr.write(`acp mcp fatal: ${error.message}\n`);
    process.exitCode = 1;
  });
} else {
  serveProviderDriverProcess(acpProviderDriver, {
    onFatalError: (error) => {
      process.stderr.write(`acp driver fatal: ${error.message}\n`);
    },
  });
}
