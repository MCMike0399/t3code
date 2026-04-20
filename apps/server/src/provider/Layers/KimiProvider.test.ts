import { describe, expect, it } from "vitest";

import { getKimiModelCapabilities } from "./KimiProvider.ts";

describe("getKimiModelCapabilities", () => {
  it("returns the built-in kimi-for-coding capabilities", () => {
    expect(getKimiModelCapabilities("kimi-for-coding")).toEqual({
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [{ value: "262144", label: "262K", isDefault: true }],
      promptInjectedEffortLevels: [],
    });
  });

  it("trims whitespace before matching the built-in slug", () => {
    expect(getKimiModelCapabilities("  kimi-for-coding  ").supportsThinkingToggle).toBe(true);
  });

  it("returns empty default capabilities for unknown custom models", () => {
    expect(getKimiModelCapabilities("custom-kimi-variant")).toEqual({
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    });
  });

  it("returns empty default capabilities when no model is provided", () => {
    expect(getKimiModelCapabilities(null)).toEqual({
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    });
    expect(getKimiModelCapabilities(undefined).supportsThinkingToggle).toBe(false);
  });
});
