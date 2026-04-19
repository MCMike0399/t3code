import { describe, expect, it } from "vitest";

import { buildKimiAcpSpawnInput } from "./KimiAcpSupport.ts";

describe("buildKimiAcpSpawnInput", () => {
  it("builds the default Kimi ACP command when no binary override is provided", () => {
    expect(buildKimiAcpSpawnInput(undefined, "/tmp/project")).toEqual({
      command: "kimi",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("falls back to `kimi` when binaryPath is an empty string", () => {
    expect(buildKimiAcpSpawnInput({ binaryPath: "" }, "/tmp/project")).toEqual({
      command: "kimi",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });

  it("uses the configured binaryPath when present", () => {
    expect(
      buildKimiAcpSpawnInput({ binaryPath: "/usr/local/bin/kimi" }, "/tmp/project"),
    ).toEqual({
      command: "/usr/local/bin/kimi",
      args: ["acp"],
      cwd: "/tmp/project",
    });
  });
});
