/**
 * KimiProvider – status probe for the Kimi CLI.
 *
 * Responsibilities:
 * - Report the hard-coded built-in model (`kimi-for-coding`).
 * - Verify the CLI is installed (`kimi --version`).
 * - Check for an existing OAuth token at
 *   `~/.kimi/credentials/kimi-code.json`. t3code never reads or writes
 *   this file — only stats it.
 *
 * @module KimiProvider
 */
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

import type {
  KimiSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderModel,
  ServerSettingsError,
} from "@t3tools/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
} from "../providerSnapshot.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { KimiProvider } from "../Services/KimiProvider.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "kimi" as const;
const KIMI_CREDENTIALS_RELATIVE_PATH = [".kimi", "credentials", "kimi-code.json"] as const;

const DEFAULT_KIMI_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "kimi-for-coding",
    name: "Kimi for Coding",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [{ value: "262144", label: "262K", isDefault: true }],
      promptInjectedEffortLevels: [],
    } satisfies ModelCapabilities,
  },
];

export function getKimiModelCapabilities(model: string | null | undefined): ModelCapabilities {
  const slug = model?.trim();
  return (
    BUILT_IN_MODELS.find((candidate) => candidate.slug === slug)?.capabilities ??
    DEFAULT_KIMI_MODEL_CAPABILITIES
  );
}

function resolveKimiCredentialsPath(): string {
  return nodePath.join(nodeOs.homedir(), ...KIMI_CREDENTIALS_RELATIVE_PATH);
}

function checkKimiCredentialsPresent(): boolean {
  try {
    const stats = nodeFs.statSync(resolveKimiCredentialsPath());
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

const runKimiCommand = Effect.fn("runKimiCommand")(function* (args: ReadonlyArray<string>) {
  const kimiSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.kimi),
  );
  const command = ChildProcess.make(kimiSettings.binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(kimiSettings.binaryPath, command);
});

function buildKimiModels(
  kimiSettings: Pick<KimiSettings, "customModels">,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    BUILT_IN_MODELS,
    PROVIDER,
    kimiSettings.customModels,
    DEFAULT_KIMI_MODEL_CAPABILITIES,
  );
}

function buildInitialKimiProviderSnapshot(kimiSettings: KimiSettings): ServerProvider {
  const checkedAt = new Date().toISOString();
  const models = buildKimiModels(kimiSettings);

  if (!kimiSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kimi is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Kimi provider status has not been checked in this session yet.",
    },
  });
}

export const checkKimiProviderStatus = Effect.fn("checkKimiProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const kimiSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.kimi),
    );
    const checkedAt = new Date().toISOString();
    const models = buildKimiModels(kimiSettings);

    if (!kimiSettings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Kimi is disabled in T3 Code settings.",
        },
      });
    }

    // ── Install / version probe ───────────────────────────────────────
    const versionProbe = yield* runKimiCommand(["--version"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: kimiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Kimi CLI (`kimi`) is not installed or not on PATH. See https://moonshotai.github.io/kimi-cli/ for installation instructions."
            : `Failed to execute Kimi CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    if (Option.isNone(versionProbe.success)) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: kimiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Kimi CLI is installed but timed out while running `kimi --version`.",
        },
      });
    }

    const versionResult = versionProbe.success.value;
    const parsedVersion = parseGenericCliVersion(
      `${versionResult.stdout}\n${versionResult.stderr}`,
    );

    if (versionResult.code !== 0) {
      const detail = detailFromResult(versionResult);
      return buildServerProvider({
        provider: PROVIDER,
        enabled: kimiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "error",
          auth: { status: "unknown" },
          message: detail
            ? `Kimi CLI is installed but failed to run. ${detail}`
            : "Kimi CLI is installed but failed to run.",
        },
      });
    }

    // ── Auth probe ────────────────────────────────────────────────────
    const credentialsPresent = checkKimiCredentialsPresent();

    if (!credentialsPresent) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: kimiSettings.enabled,
        checkedAt,
        models,
        probe: {
          installed: true,
          version: parsedVersion,
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Kimi is not authenticated. Run `kimi login` in a terminal to authenticate.",
        },
      });
    }

    return buildServerProvider({
      provider: PROVIDER,
      enabled: kimiSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "ready",
        auth: {
          status: "authenticated",
          type: "kimi-code",
          label: "Kimi Code Account",
        },
      },
    });
  },
);

export const KimiProviderLive = Layer.effect(
  KimiProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const checkProvider = checkKimiProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<KimiSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.kimi),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.kimi),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: buildInitialKimiProviderSnapshot,
      checkProvider,
    });
  }),
);
