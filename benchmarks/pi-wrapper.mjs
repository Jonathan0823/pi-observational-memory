#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";

const piCli = process.env.PI_BENCHMARK_REAL_PI_CLI;
if (!piCli) throw new Error("PI_BENCHMARK_REAL_PI_CLI is required by the benchmark Pi wrapper");

const args = process.argv.slice(2);
const pacerExtension = process.env.PI_BENCHMARK_PACER_EXTENSION;
if (process.env.OM_WORKER && pacerExtension && !args.includes(pacerExtension)) {
	const extensionIndex = args.indexOf("-e");
	if (extensionIndex >= 0) args.splice(extensionIndex + 2, 0, "-e", pacerExtension);
}

// Keep this wrapper as argv[1]. The OM worker launcher resolves that entrypoint and
// re-enters this file, which injects the pacer into worker Pi processes as well.
process.argv = [process.execPath, fileURLToPath(import.meta.url), ...args];
await import(pathToFileURL(piCli).href);
