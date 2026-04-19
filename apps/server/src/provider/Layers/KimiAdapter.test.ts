import * as path from "node:path";
import * as os from "node:os";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";

import { ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { KimiAdapter } from "../Services/KimiAdapter.ts";
import { makeKimiAdapterLive } from "./KimiAdapter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const bunExe = "bun";

async function makeMockAgentWrapper(extraEnv?: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kimi-acp-mock-"));
  const wrapperPath = path.join(dir, "fake-agent.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${JSON.stringify(bunExe)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function waitForFileContent(filePath: string, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await readFile(filePath, "utf8");
      if (raw.trim().length > 0) {
        return raw;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file content at ${filePath}`);
}

const kimiAdapterTestLayer = it.layer(
  makeKimiAdapterLive().pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-kimi-adapter-test-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

kimiAdapterTestLayer("KimiAdapterLive", (it) => {
  it.effect("rejects startSession when provider does not match", () =>
    Effect.gen(function* () {
      const adapter = yield* KimiAdapter;
      const result = yield* adapter
        .startSession({
          threadId: ThreadId.make("kimi-bad-provider"),
          provider: "codex",
          cwd: process.cwd(),
          runtimeMode: "full-access",
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");
    }),
  );

  it.effect("starts a session and maps mock ACP prompt flow to runtime events", () =>
    Effect.gen(function* () {
      const adapter = yield* KimiAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.make("kimi-mock-thread");

      const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper());
      yield* settings.updateSettings({ providers: { kimi: { binaryPath: wrapperPath } } });

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 9).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        provider: "kimi",
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { provider: "kimi", model: "kimi-for-coding" },
      });

      assert.equal(session.provider, "kimi");

      yield* adapter.sendTurn({
        threadId,
        input: "hello mock",
        attachments: [],
      });

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const types = runtimeEvents.map((e) => e.type);

      for (const t of [
        "session.started",
        "thread.started",
        "turn.started",
        "content.delta",
        "turn.completed",
      ] as const) {
        assert.include(types, t);
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("closes the ACP child process when a session stops", () =>
    Effect.gen(function* () {
      const adapter = yield* KimiAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.make("kimi-stop-session-close");
      const tempDir = yield* Effect.promise(() =>
        mkdtemp(path.join(os.tmpdir(), "kimi-adapter-exit-log-")),
      );
      const exitLogPath = path.join(tempDir, "exit.log");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockAgentWrapper({
          T3_ACP_EXIT_LOG_PATH: exitLogPath,
        }),
      );
      yield* settings.updateSettings({ providers: { kimi: { binaryPath: wrapperPath } } });

      yield* adapter.startSession({
        threadId,
        provider: "kimi",
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { provider: "kimi", model: "kimi-for-coding" },
      });

      yield* adapter.stopSession(threadId);

      const exitLog = yield* Effect.promise(() => waitForFileContent(exitLogPath));
      assert.include(exitLog, "SIGTERM");
    }),
  );
});
