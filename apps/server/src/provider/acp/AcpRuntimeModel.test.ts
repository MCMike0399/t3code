import { describe, expect, it } from "vitest";

import type * as EffectAcpSchema from "effect-acp/schema";

import {
  extractModelConfigId,
  mergeToolCallState,
  parsePermissionRequest,
  parseSessionModeState,
  parseSessionUpdateEvent,
} from "./AcpRuntimeModel.ts";

describe("AcpRuntimeModel", () => {
  it("parses session mode state from typed ACP session setup responses", () => {
    const modeState = parseSessionModeState({
      sessionId: "session-1",
      modes: {
        currentModeId: " code ",
        availableModes: [
          { id: " ask ", name: " Ask ", description: " Request approval " },
          { id: " code ", name: " Code " },
        ],
      },
      configOptions: [],
    } satisfies EffectAcpSchema.NewSessionResponse);

    expect(modeState).toEqual({
      currentModeId: "code",
      availableModes: [
        { id: "ask", name: "Ask", description: "Request approval" },
        { id: "code", name: "Code" },
      ],
    });
  });

  it("extracts the model config id from typed ACP config options", () => {
    const modelConfigId = extractModelConfigId({
      sessionId: "session-1",
      configOptions: [
        {
          id: "approval",
          name: "Approval Mode",
          category: "permission",
          type: "select",
          currentValue: "ask",
          options: [{ value: "ask", name: "Ask" }],
        },
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: "default",
          options: [{ value: "default", name: "Auto" }],
        },
      ],
    } satisfies EffectAcpSchema.NewSessionResponse);

    expect(modelConfigId).toBe("model");
  });

  it("projects typed ACP tool call updates into runtime events", () => {
    const created = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Terminal",
        kind: "execute",
        status: "pending",
        rawInput: {
          executable: "bun",
          args: ["run", "typecheck"],
        },
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Running checks",
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(created.events).toEqual([
      {
        _tag: "ToolCallUpdated",
        toolCall: {
          toolCallId: "tool-1",
          kind: "execute",
          title: "Ran command",
          status: "pending",
          command: "bun run typecheck",
          detail: "bun run typecheck",
          data: {
            toolCallId: "tool-1",
            kind: "execute",
            command: "bun run typecheck",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Terminal",
            kind: "execute",
            status: "pending",
            rawInput: {
              executable: "bun",
              args: ["run", "typecheck"],
            },
            content: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Running checks",
                },
              },
            ],
          },
        },
      },
    ]);

    const updated = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: { exitCode: 0 },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(updated.events).toHaveLength(1);
    expect(updated.events[0]?._tag).toBe("ToolCallUpdated");
    const createdEvent = created.events[0];
    const updatedEvent = updated.events[0];
    if (createdEvent?._tag === "ToolCallUpdated" && updatedEvent?._tag === "ToolCallUpdated") {
      expect(mergeToolCallState(createdEvent.toolCall, updatedEvent.toolCall)).toMatchObject({
        toolCallId: "tool-1",
        status: "completed",
        title: "Ran command",
        detail: "bun run typecheck",
        command: "bun run typecheck",
      });
    }
  });

  it("trims padded current mode updates before emitting a mode change", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: " code ",
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.modeId).toBe("code");
    expect(result.events).toEqual([
      {
        _tag: "ModeChanged",
        modeId: "code",
      },
    ]);
  });

  it("projects typed ACP plan and content updates", () => {
    const planResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: " Inspect state ", priority: "high", status: "completed" },
          { content: "", priority: "medium", status: "in_progress" },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(planResult.events).toEqual([
      {
        _tag: "PlanUpdated",
        payload: {
          plan: [
            { step: "Inspect state", status: "completed" },
            { step: "Step 2", status: "inProgress" },
          ],
        },
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: " Inspect state ", priority: "high", status: "completed" },
              { content: "", priority: "medium", status: "in_progress" },
            ],
          },
        },
      },
    ]);

    const contentResult = parseSessionUpdateEvent({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "hello from acp",
        },
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(contentResult.events).toEqual([
      {
        _tag: "ContentDelta",
        text: "hello from acp",
        rawPayload: {
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "hello from acp",
            },
          },
        },
      },
    ]);
  });

  it("infers execute-kind and command from a Kimi-style `Shell: <cmd>` title when kind is omitted", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-kimi",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "kimi-tool-1",
        title: "Shell: uname -a && ls -1 | head -3",
        status: "in_progress",
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    if (event?._tag !== "ToolCallUpdated") {
      throw new Error("expected ToolCallUpdated");
    }
    expect(event.toolCall).toMatchObject({
      kind: "execute",
      status: "inProgress",
      command: "uname -a && ls -1 | head -3",
    });
    expect(event.toolCall.data).toMatchObject({
      kind: "execute",
      command: "uname -a && ls -1 | head -3",
    });
  });

  it("extracts the description field from a partially-streamed Agent tool JSON input", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-kimi",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "kimi-agent-1",
        title: "Agent",
        status: "in_progress",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: '{"description": "Explore codebase', // partial JSON, mid-stream
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    if (event?._tag !== "ToolCallUpdated") throw new Error("expected ToolCallUpdated");
    expect(event.toolCall.detail).toBe("Explore codebase");
  });

  it("uses the parsed description from complete Agent JSON over the literal title", () => {
    const result = parseSessionUpdateEvent({
      sessionId: "session-kimi",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "kimi-agent-2",
        title: "Agent",
        status: "in_progress",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: '{"description":"Audit auth","prompt":"check the session middleware","subagent_type":"coder"}',
            },
          },
        ],
      },
    } satisfies EffectAcpSchema.SessionNotification);

    const [event] = result.events;
    if (event?._tag !== "ToolCallUpdated") throw new Error("expected ToolCallUpdated");
    expect(event.toolCall.detail).toBe("Audit auth");
  });

  it("routes a Kimi-style shell permission request to exec_command_approval shape", () => {
    const request = parsePermissionRequest({
      sessionId: "session-kimi",
      options: [
        { optionId: "approve", name: "Approve once", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
      toolCall: {
        toolCallId: "kimi-tool-2",
        title: "Shell: rm -rf /tmp/junk",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Requesting approval to perform: Run command `rm -rf /tmp/junk`",
            },
          },
        ],
      },
    });

    expect(request).toMatchObject({
      kind: "execute",
      detail: "rm -rf /tmp/junk",
      toolCall: {
        kind: "execute",
        command: "rm -rf /tmp/junk",
        status: "pending",
      },
    });
  });

  it("keeps permission request parsing compatible with loose extension payloads", () => {
    const request = parsePermissionRequest({
      sessionId: "session-1",
      options: [
        {
          optionId: "allow-once",
          name: "Allow once",
          kind: "allow_once",
        },
      ],
      toolCall: {
        toolCallId: "tool-1",
        title: "`cat package.json`",
        kind: "execute",
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Not in allowlist",
            },
          },
        ],
      },
    });

    expect(request).toMatchObject({
      kind: "execute",
      detail: "cat package.json",
      toolCall: {
        toolCallId: "tool-1",
        kind: "execute",
        status: "pending",
        command: "cat package.json",
      },
    });
  });
});
