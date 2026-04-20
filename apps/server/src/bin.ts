import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import { NetService } from "@t3tools/shared/Net";
import { cli } from "./cli.ts";
import { fixPath } from "./os-jank.ts";
import packageJson from "../package.json" with { type: "json" };

// Hydrate PATH from the user's login shell before anything else runs.
// Electron launches GUI children with a minimal PATH (no ~/.local/bin,
// no /usr/local/bin, no Homebrew), which prevents provider CLIs like
// `kimi`, `claude`, `codex`, `opencode` from being spawned when the
// user hasn't configured absolute binary paths. This must run before
// any ChildProcessSpawner effect is constructed.
fixPath();

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

Command.run(cli, { version: packageJson.version }).pipe(
  Effect.scoped,
  Effect.provide(CliRuntimeLayer),
  NodeRuntime.runMain,
);
