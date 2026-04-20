#!/usr/bin/env bun
/**
 * End-to-end smoke test: drive the live KimiAdapter against the real
 * `kimi acp` binary, send one prompt that exercises tool calls and
 * thinking, and print every ProviderRuntimeEvent we emit.
 *
 * Run:   bun run apps/server/scripts/kimi-smoke.ts
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, Layer, Stream } from "effect";

import { ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../src/config.ts";
import { ServerSettingsService } from "../src/serverSettings.ts";
import { makeKimiAdapterLive } from "../src/provider/Layers/KimiAdapter.ts";
import { KimiAdapter } from "../src/provider/Services/KimiAdapter.ts";

const PROMPT =
  process.argv.slice(2).join(" ").trim() ||
  "Use the shell tool to run `uname -a` and briefly summarize the output. Do not edit any files.";

const program = Effect.gen(function* () {
  const workDir = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "kimi-smoke-")));
  const adapter = yield* KimiAdapter;
  const threadId = ThreadId.make("kimi-smoke");
  const events: Array<unknown> = [];

  const fiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
    Effect.sync(() => {
      events.push(event);
      const e = event as {
        type: string;
        payload?: Record<string, unknown>;
        itemId?: unknown;
      };
      const payload = e.payload ?? {};
      const streamKind = (payload as { streamKind?: string }).streamKind;
      const delta = (payload as { delta?: string }).delta;
      const itemType = (payload as { itemType?: string }).itemType;
      const status = (payload as { status?: string }).status;
      const title = (payload as { title?: string }).title;
      const detail = (payload as { detail?: string }).detail;
      const requestType = (payload as { requestType?: string }).requestType;

      if (e.type === "content.delta") {
        process.stdout.write(`[${streamKind === "reasoning_text" ? "THINK" : "MSG  "}] ${delta}\n`);
      } else if (e.type.startsWith("item.") && itemType) {
        process.stdout.write(
          `[${e.type.toUpperCase().padEnd(14)}] itemType=${itemType} status=${status ?? "-"} title=${JSON.stringify(title ?? "")} detail=${JSON.stringify(detail ?? "")}\n`,
        );
      } else if (e.type === "request.opened") {
        process.stdout.write(
          `[REQUEST.OPENED  ] type=${requestType} detail=${JSON.stringify(detail ?? "")}\n`,
        );
      } else if (e.type === "request.resolved") {
        const decision = (payload as { decision?: string }).decision;
        process.stdout.write(`[REQUEST.RESOLVED] type=${requestType} decision=${decision}\n`);
      } else {
        process.stdout.write(`[${e.type.toUpperCase().padEnd(16)}]\n`);
      }
    }),
  ).pipe(Effect.forkChild);

  yield* adapter.startSession({
    threadId,
    provider: "kimi",
    cwd: workDir,
    runtimeMode: "full-access",
  });

  yield* adapter.sendTurn({ threadId, input: PROMPT, attachments: [] });
  yield* adapter.stopSession(threadId);
  yield* Fiber.interrupt(fiber);

  process.stdout.write(`\n--- summary: ${events.length} runtime events ---\n`);
  const byType = new Map<string, number>();
  for (const e of events) {
    const t = (e as { type: string }).type;
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  for (const [t, n] of byType) process.stdout.write(`  ${t}: ${n}\n`);
});

const layer = makeKimiAdapterLive().pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "kimi-smoke-" })),
  Layer.provideMerge(NodeServices.layer),
);

await Effect.runPromise(program.pipe(Effect.provide(layer), Effect.scoped));
