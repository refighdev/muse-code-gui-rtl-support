// Captured from a real `muse serve` (Muse Code 1.1.1) session by a probe script, then sanitized.
// Three turns: a one-word reply, a shell tool call, and a request_user_input question.
import type { ViewEvent } from "../../src/types.js";

export const liveEvents: ViewEvent[] = [
  {
    "method": "session/started",
    "params": {
      "session": {
        "activeTurnId": null,
        "approvalMode": {
          "lastCommandId": null,
          "mode": "onRequest",
          "source": "startup"
        },
        "createdAt": "2026-09-11T13:58:45.506824Z",
        "forkedFrom": null,
        "modelId": "muse-spark-1.3-contributor",
        "path": "/home/dev/.local/share/muse/sessions/2026/09/11/01a090c3-7bfd-7783-a745-f0a4449690bc/session.jsonl",
        "providerId": "meta",
        "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
        "status": "idle",
        "turnCount": 0,
        "updatedAt": "2026-09-11T13:58:45.506828Z",
        "workspaceRoot": "/mnt/d/work/probe"
      }
    },
    "at": 1789135125688
  },
  {
    "method": "session/approvalModeChanged",
    "params": {
      "clientName": "musegui_probe",
      "commandId": "01a090c3-a411-7000-af99-8973e9766bf4",
      "mode": "onRequest",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "source": "approvalReconfigure",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:1"
    },
    "at": 1789135125688
  },
  {
    "method": "turn/started",
    "params": {
      "commandId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:2"
    },
    "at": 1789135125725
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "commandId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
        "itemId": "851efcd2-6467-4494-a4a4-54c1e0ab3380",
        "kind": "userMessage",
        "recordedAt": "2026-09-11T13:58:45.722817Z",
        "revision": 1,
        "status": "completed",
        "text": "Reply with exactly one word: pong",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:3"
    },
    "at": 1789135125725
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "e87cd57f-eee6-4da2-af05-ad34762d7001",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "e796ec3d-9e0e-4542-aa82-84910a27cded",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:58:45.769117Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c3-7cf8-7973-8fc1-506fe707c3f9",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:4"
    },
    "at": 1789135125773
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "itemId": "dc6bb53d-242e-4cac-8ea8-7264bcb4e3ec",
        "kind": "agentMessage",
        "revision": 1,
        "status": "inProgress",
        "text": "",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:5"
    },
    "at": 1789135129404
  },
  {
    "method": "item/delta",
    "params": {
      "delta": "pong",
      "field": "text",
      "itemId": "dc6bb53d-242e-4cac-8ea8-7264bcb4e3ec",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:6"
    },
    "at": 1789135129404
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "itemId": "dc6bb53d-242e-4cac-8ea8-7264bcb4e3ec",
        "kind": "agentMessage",
        "recordedAt": "2026-09-11T13:58:49.404592Z",
        "revision": 2,
        "status": "completed",
        "text": "pong",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:7"
    },
    "at": 1789135129408
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 19,
        "promptTokens": 21158,
        "totalTokens": 21177
      },
      "durationMs": 4179,
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21158,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 21177,
      "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21158,
        "outputTokens": 19,
        "reasoningTokens": 8
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:8"
    },
    "at": 1789135129583
  },
  {
    "method": "session/contextUsage",
    "params": {
      "pressure": "normal",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "usedTokens": 21177,
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:9",
      "windowTokens": 1007997
    },
    "at": 1789135129583
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "16439248-38fe-4418-8a81-f4f7ae37d256",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "9306a93c-1efa-44bd-94f5-6b5dfcde9c51",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:58:49.605698Z",
        "reminderAgentId": "goal-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c3-8bf2-7ac0-987b-cd48b51e9c5a",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:10"
    },
    "at": 1789135129608
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "5fe80bf1-22b0-4e31-9ae2-bddc0a5544a1",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "1d2f0f3d-5629-4372-98c2-3488c2009ca6",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:58:49.629507Z",
        "reminderAgentId": "verify-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c3-8c0c-73b0-b8d1-3e5960c55294",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:11"
    },
    "at": 1789135129633
  },
  {
    "method": "turn/completed",
    "params": {
      "durationMs": 42316,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "terminal": "completed",
      "timeToFirstTokenMs": 4096,
      "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:12"
    },
    "at": 1789135164705
  },
  {
    "method": "turn/started",
    "params": {
      "commandId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:13"
    },
    "at": 1789135164746
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "commandId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
        "itemId": "39f04c84-55e5-4684-af22-af2cb69f6a77",
        "kind": "userMessage",
        "recordedAt": "2026-09-11T13:59:24.740192Z",
        "revision": 1,
        "status": "completed",
        "text": "Run the shell command `ls -la` in the workspace, then tell me how many entries it printed.",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:14"
    },
    "at": 1789135164746
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "899da2bb-da48-46b4-9cd0-20e291f56b62",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "08878048-2b40-49f5-8d4c-5080ac90f8c1",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:24.798876Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-156d-77f1-b21e-3d328bbdf34e",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:15"
    },
    "at": 1789135164802
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 201,
        "promptTokens": 42363,
        "totalTokens": 42564
      },
      "durationMs": 21317,
      "finishReason": "tool_calls",
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21205,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 21387,
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21205,
        "outputTokens": 182,
        "reasoningTokens": 92
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:16"
    },
    "at": 1789135184497
  },
  {
    "method": "session/contextUsage",
    "params": {
      "pressure": "normal",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "usedTokens": 21387,
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:17",
      "windowTokens": 1007997
    },
    "at": 1789135184497
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "args": "{\"command\":\"ls -la\",\"description\":\"List workspace directory contents\"}",
        "callId": "call_01a090c45fdc7000b385791359fe7926",
        "itemId": "01a090c4-627c-73c3-83b3-59f77ae7b746",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T13:59:44.52346Z",
        "revision": 1,
        "status": "inProgress",
        "tool": "bash",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:18"
    },
    "at": 1789135184526
  },
  {
    "method": "item/delta",
    "params": {
      "delta": "total 0\ndrwxrwxrwx 1 dev dev 4096 Sep 11 06:58 .\ndrwxrwxrwx 1 dev dev 4096 Sep 11 06:58 ..\n-rwxrwxrwx 1 dev dev   27 Sep 11 06:58 README.md\n-rwxrwxrwx 1 dev dev   22 Sep 11 06:58 index.js\n",
      "field": "output",
      "itemId": "01a090c4-627c-73c3-83b3-59f77ae7b746",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:19"
    },
    "at": 1789135184731
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "args": "{\"command\":\"ls -la\",\"description\":\"List workspace directory contents\"}",
        "callId": "call_01a090c45fdc7000b385791359fe7926",
        "itemId": "01a090c4-627c-73c3-83b3-59f77ae7b746",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T13:59:44.749416Z",
        "revision": 2,
        "status": "completed",
        "tool": "bash",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
        "visibleOutput": "total 0\ndrwxrwxrwx 1 dev dev 4096 Sep 11 06:58 .\ndrwxrwxrwx 1 dev dev 4096 Sep 11 06:58 ..\n-rwxrwxrwx 1 dev dev   27 Sep 11 06:58 README.md\n-rwxrwxrwx 1 dev dev   22 Sep 11 06:58 index.js\n"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:20"
    },
    "at": 1789135184751
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "7e4406e0-5ed1-411f-95ff-2ba6d275c099",
        "fallbackText": "Reminder child session",
        "generationId": 2,
        "itemId": "02667910-aa11-4c60-8b08-c3a8ee39a9d9",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:44.794267Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-6387-72d1-870b-0fec0468c909",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:21"
    },
    "at": 1789135184798
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "itemId": "c9bbeeb9-82b1-45ce-8aad-196dabf11b2b",
        "kind": "agentMessage",
        "revision": 1,
        "status": "inProgress",
        "text": "",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:22"
    },
    "at": 1789135190610
  },
  {
    "method": "item/delta",
    "params": {
      "delta": "`",
      "field": "text",
      "itemId": "c9bbeeb9-82b1-45ce-8aad-196dabf11b2b",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:23"
    },
    "at": 1789135190610
  },
  {
    "method": "item/delta",
    "params": {
      "delta": "ls -la` printed 4 entries: `.`, `..",
      "field": "text",
      "itemId": "c9bbeeb9-82b1-45ce-8aad-196dabf11b2b",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:24"
    },
    "at": 1789135190632
  },
  {
    "method": "item/delta",
    "params": {
      "delta": "`, `README.md`, `index.js`.",
      "field": "text",
      "itemId": "c9bbeeb9-82b1-45ce-8aad-196dabf11b2b",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:25"
    },
    "at": 1789135190666
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "itemId": "c9bbeeb9-82b1-45ce-8aad-196dabf11b2b",
        "kind": "agentMessage",
        "recordedAt": "2026-09-11T13:59:50.666171Z",
        "revision": 2,
        "status": "completed",
        "text": "`ls -la` printed 4 entries: `.`, `..`, `README.md`, `index.js`.",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:26"
    },
    "at": 1789135190668
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 427,
        "promptTokens": 63936,
        "totalTokens": 64363
      },
      "durationMs": 6302,
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21573,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 21799,
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21573,
        "outputTokens": 226,
        "reasoningTokens": 193
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:27"
    },
    "at": 1789135190726
  },
  {
    "method": "session/contextUsage",
    "params": {
      "pressure": "normal",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "usedTokens": 21799,
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:28",
      "windowTokens": 1007997
    },
    "at": 1789135190726
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "a9d43188-ec35-4e5a-9c39-d6d0d8aad5a9",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "71f3f4ba-06b0-40d8-a8c8-d1bce02a7c1c",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:50.767622Z",
        "reminderAgentId": "goal-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-7adb-7012-99a0-58a7422e0c9c",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:29"
    },
    "at": 1789135190770
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "a7fa14b0-82ab-4354-81be-4268bb1f438b",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "3eb225c3-550e-4dac-b728-95de5d78c264",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:50.789792Z",
        "reminderAgentId": "verify-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-7af5-72c0-b289-561c448ba045",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:30"
    },
    "at": 1789135190793
  },
  {
    "method": "turn/completed",
    "params": {
      "durationMs": 44309,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "terminal": "completed",
      "timeToFirstTokenMs": 27948,
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:31"
    },
    "at": 1789135205720
  },
  {
    "method": "turn/started",
    "params": {
      "commandId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:32"
    },
    "at": 1789135205765
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "commandId": "01a090c4-dd69-7000-9595-de62e24b1ead",
        "itemId": "d71fc26b-37b6-47b8-aa6a-7152454c2c8a",
        "kind": "userMessage",
        "recordedAt": "2026-09-11T14:00:05.762347Z",
        "revision": 1,
        "status": "completed",
        "text": "Use your ask-the-user question tool to ask me one multiple-choice question: which color do I prefer, red or blue. After I answer, reply with only my choice.",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:33"
    },
    "at": 1789135205765
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "25759647-24a7-4ffb-9240-5afadbe38e55",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "8e32f1e0-b1a0-4367-9abc-8a914e427b09",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T14:00:05.808448Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-b5a3-7202-ae37-39f217897f2b",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:34"
    },
    "at": 1789135205812
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 656,
        "promptTokens": 85776,
        "totalTokens": 86432
      },
      "durationMs": 3745,
      "finishReason": "tool_calls",
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21840,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 22069,
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21840,
        "outputTokens": 229,
        "reasoningTokens": 114
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:35"
    },
    "at": 1789135209190
  },
  {
    "method": "session/contextUsage",
    "params": {
      "pressure": "normal",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "usedTokens": 22069,
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:36",
      "windowTokens": 1007997
    },
    "at": 1789135209190
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "args": "{\"questions\":[{\"header\":\"Color\",\"id\":\"color_pref\",\"options\":[{\"label\":\"Red\"},{\"label\":\"Blue\"}],\"question\":\"Which color do you prefer?\",\"selection\":{\"mode\":\"single\"}}]}",
        "callId": "call_01a090c4bf2170f0bcf44050dfb432ed",
        "itemId": "01a090c4-c310-73c1-871b-2b08dd18070f",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T14:00:09.242998Z",
        "revision": 1,
        "status": "inProgress",
        "tool": "request_user_input",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:37"
    },
    "at": 1789135209245
  },
  {
    "method": "userInput/requested",
    "params": {
      "itemId": "01a090c4-c310-73c1-871b-2b08dd18070f",
      "questions": [
        {
          "header": "Color",
          "id": "color_pref",
          "options": [
            {
              "label": "Red"
            },
            {
              "label": "Blue"
            }
          ],
          "question": "Which color do you prefer?",
          "selection": {
            "mode": "single"
          }
        }
      ],
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "toolCallId": "call_01a090c4bf2170f0bcf44050dfb432ed",
      "toolName": "request_user_input",
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "userInputId": "01a090c4-c310-73c1-871b-2b08dd18070f",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:38"
    },
    "at": 1789135209248
  },
  {
    "method": "userInput/settled",
    "params": {
      "answers": [
        {
          "questionId": "color_pref",
          "selectedLabel": "Blue"
        }
      ],
      "clarification": null,
      "decidedByCommandId": "01a090c4-eba1-7000-ac35-589ed041c07b",
      "outcome": "answered",
      "reason": null,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "userInputId": "01a090c4-c310-73c1-871b-2b08dd18070f",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:39"
    },
    "at": 1789135209258
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "args": "{\"questions\":[{\"header\":\"Color\",\"id\":\"color_pref\",\"options\":[{\"label\":\"Red\"},{\"label\":\"Blue\"}],\"question\":\"Which color do you prefer?\",\"selection\":{\"mode\":\"single\"}}]}",
        "callId": "call_01a090c4bf2170f0bcf44050dfb432ed",
        "itemId": "01a090c4-c310-73c1-871b-2b08dd18070f",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T14:00:09.261092Z",
        "revision": 2,
        "status": "completed",
        "tool": "request_user_input",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
        "visibleOutput": "{\"status\":\"answered\",\"answers\":[{\"id\":\"color_pref\",\"selected_label\":\"Blue\"}]}"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:40"
    },
    "at": 1789135209263
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "itemId": "55af1d46-e143-4d80-bf8b-2e6eeb225080",
        "kind": "agentMessage",
        "revision": 1,
        "status": "inProgress",
        "text": "",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:41"
    },
    "at": 1789135212470
  },
  {
    "method": "item/delta",
    "params": {
      "delta": "Blue",
      "field": "text",
      "itemId": "55af1d46-e143-4d80-bf8b-2e6eeb225080",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:42"
    },
    "at": 1789135212470
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "itemId": "55af1d46-e143-4d80-bf8b-2e6eeb225080",
        "kind": "agentMessage",
        "recordedAt": "2026-09-11T14:00:12.470986Z",
        "revision": 2,
        "status": "completed",
        "text": "Blue",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:43"
    },
    "at": 1789135212476
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 717,
        "promptTokens": 107888,
        "totalTokens": 108605
      },
      "durationMs": 3315,
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 22112,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 22173,
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "usage": {
        "cacheReadTokens": 21745,
        "cacheWriteTokens": 0,
        "cachedTokens": 21745,
        "inputTokens": 22112,
        "outputTokens": 61,
        "reasoningTokens": 50
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:44"
    },
    "at": 1789135212642
  },
  {
    "method": "session/contextUsage",
    "params": {
      "pressure": "normal",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "usedTokens": 22173,
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:45",
      "windowTokens": 1007997
    },
    "at": 1789135212642
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "bd446ab6-aacd-47c3-9798-cc9ecd3dcc3e",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "9483b954-03ff-4c6f-9a80-9a77bd4dd9fd",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T14:00:12.666708Z",
        "reminderAgentId": "goal-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-d066-7752-ba00-d7b2f8f65f7a",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:46"
    },
    "at": 1789135212669
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "c2f54039-2b65-44a3-adcb-ac796f4ec438",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "5c77cb75-5252-474b-8ca9-b648d61584a0",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T14:00:12.692815Z",
        "reminderAgentId": "verify-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-d081-72c2-8cda-763ed35935c7",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:47"
    },
    "at": 1789135212696
  },
  {
    "method": "turn/completed",
    "params": {
      "durationMs": 73471,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "terminal": "completed",
      "timeToFirstTokenMs": 7137,
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:48"
    },
    "at": 1789135273398
  },
  {
    "method": "session/closed",
    "params": {
      "reason": "hostShutdown",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:48"
    },
    "at": 1789135273495
  }
];

export const historyEvents: ViewEvent[] = [
  {
    "method": "session/approvalModeChanged",
    "params": {
      "clientName": "musegui_probe",
      "commandId": "01a090c3-a411-7000-af99-8973e9766bf4",
      "mode": "onRequest",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "source": "approvalReconfigure",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:1"
    }
  },
  {
    "method": "turn/started",
    "params": {
      "commandId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:2"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "commandId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
        "itemId": "851efcd2-6467-4494-a4a4-54c1e0ab3380",
        "kind": "userMessage",
        "recordedAt": "2026-09-11T13:58:45.722817Z",
        "revision": 1,
        "status": "completed",
        "text": "Reply with exactly one word: pong",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:3"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "e87cd57f-eee6-4da2-af05-ad34762d7001",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "e796ec3d-9e0e-4542-aa82-84910a27cded",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:58:45.769117Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c3-7cf8-7973-8fc1-506fe707c3f9",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:4"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "itemId": "dc6bb53d-242e-4cac-8ea8-7264bcb4e3ec",
        "kind": "agentMessage",
        "recordedAt": "2026-09-11T13:58:49.404592Z",
        "revision": 1,
        "status": "completed",
        "text": "pong",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:5"
    }
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 19,
        "promptTokens": 21158,
        "totalTokens": 21177
      },
      "durationMs": 4179,
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21158,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 21177,
      "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21158,
        "outputTokens": 19,
        "reasoningTokens": 8
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:6"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "16439248-38fe-4418-8a81-f4f7ae37d256",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "9306a93c-1efa-44bd-94f5-6b5dfcde9c51",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:58:49.605698Z",
        "reminderAgentId": "goal-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c3-8bf2-7ac0-987b-cd48b51e9c5a",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:7"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "5fe80bf1-22b0-4e31-9ae2-bddc0a5544a1",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "1d2f0f3d-5629-4372-98c2-3488c2009ca6",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:58:49.629507Z",
        "reminderAgentId": "verify-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c3-8c0c-73b0-b8d1-3e5960c55294",
        "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:8"
    }
  },
  {
    "method": "turn/completed",
    "params": {
      "durationMs": 42316,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "terminal": "completed",
      "timeToFirstTokenMs": 4096,
      "turnId": "01a090c3-a4c0-7000-8f46-0d3ccf6404af",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:9"
    }
  },
  {
    "method": "turn/started",
    "params": {
      "commandId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:10"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "commandId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
        "itemId": "39f04c84-55e5-4684-af22-af2cb69f6a77",
        "kind": "userMessage",
        "recordedAt": "2026-09-11T13:59:24.740192Z",
        "revision": 1,
        "status": "completed",
        "text": "Run the shell command `ls -la` in the workspace, then tell me how many entries it printed.",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:11"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "899da2bb-da48-46b4-9cd0-20e291f56b62",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "08878048-2b40-49f5-8d4c-5080ac90f8c1",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:24.798876Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-156d-77f1-b21e-3d328bbdf34e",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:12"
    }
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 201,
        "promptTokens": 42363,
        "totalTokens": 42564
      },
      "durationMs": 21317,
      "finishReason": "tool_calls",
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21205,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 21387,
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21205,
        "outputTokens": 182,
        "reasoningTokens": 92
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:13"
    }
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "args": "{\"command\":\"ls -la\",\"description\":\"List workspace directory contents\"}",
        "callId": "call_01a090c45fdc7000b385791359fe7926",
        "itemId": "01a090c4-627c-73c3-83b3-59f77ae7b746",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T13:59:44.52346Z",
        "revision": 1,
        "status": "inProgress",
        "tool": "bash",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:14"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "args": "{\"command\":\"ls -la\",\"description\":\"List workspace directory contents\"}",
        "callId": "call_01a090c45fdc7000b385791359fe7926",
        "itemId": "01a090c4-627c-73c3-83b3-59f77ae7b746",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T13:59:44.749416Z",
        "revision": 2,
        "status": "completed",
        "tool": "bash",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
        "visibleOutput": "total 0\ndrwxrwxrwx 1 dev dev 4096 Sep 11 06:58 .\ndrwxrwxrwx 1 dev dev 4096 Sep 11 06:58 ..\n-rwxrwxrwx 1 dev dev   27 Sep 11 06:58 README.md\n-rwxrwxrwx 1 dev dev   22 Sep 11 06:58 index.js\n"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:16"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "7e4406e0-5ed1-411f-95ff-2ba6d275c099",
        "fallbackText": "Reminder child session",
        "generationId": 2,
        "itemId": "02667910-aa11-4c60-8b08-c3a8ee39a9d9",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:44.794267Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-6387-72d1-870b-0fec0468c909",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:17"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "itemId": "c9bbeeb9-82b1-45ce-8aad-196dabf11b2b",
        "kind": "agentMessage",
        "recordedAt": "2026-09-11T13:59:50.666171Z",
        "revision": 1,
        "status": "completed",
        "text": "`ls -la` printed 4 entries: `.`, `..`, `README.md`, `index.js`.",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:18"
    }
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 427,
        "promptTokens": 63936,
        "totalTokens": 64363
      },
      "durationMs": 6302,
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21573,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 21799,
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21573,
        "outputTokens": 226,
        "reasoningTokens": 193
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:19"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "a9d43188-ec35-4e5a-9c39-d6d0d8aad5a9",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "71f3f4ba-06b0-40d8-a8c8-d1bce02a7c1c",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:50.767622Z",
        "reminderAgentId": "goal-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-7adb-7012-99a0-58a7422e0c9c",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:20"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "a7fa14b0-82ab-4354-81be-4268bb1f438b",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "3eb225c3-550e-4dac-b728-95de5d78c264",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T13:59:50.789792Z",
        "reminderAgentId": "verify-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-7af5-72c0-b289-561c448ba045",
        "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:21"
    }
  },
  {
    "method": "turn/completed",
    "params": {
      "durationMs": 44309,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "terminal": "completed",
      "timeToFirstTokenMs": 27948,
      "turnId": "01a090c4-3d7c-7000-9be4-7c3b03f35a28",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:22"
    }
  },
  {
    "method": "turn/started",
    "params": {
      "commandId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:23"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "commandId": "01a090c4-dd69-7000-9595-de62e24b1ead",
        "itemId": "d71fc26b-37b6-47b8-aa6a-7152454c2c8a",
        "kind": "userMessage",
        "recordedAt": "2026-09-11T14:00:05.762347Z",
        "revision": 1,
        "status": "completed",
        "text": "Use your ask-the-user question tool to ask me one multiple-choice question: which color do I prefer, red or blue. After I answer, reply with only my choice.",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:24"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "25759647-24a7-4ffb-9240-5afadbe38e55",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "8e32f1e0-b1a0-4367-9abc-8a914e427b09",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T14:00:05.808448Z",
        "reminderAgentId": "skill-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-b5a3-7202-ae37-39f217897f2b",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:25"
    }
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 656,
        "promptTokens": 85776,
        "totalTokens": 86432
      },
      "durationMs": 3745,
      "finishReason": "tool_calls",
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 21840,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 22069,
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "usage": {
        "cacheReadTokens": 0,
        "cacheWriteTokens": 0,
        "cachedTokens": 0,
        "inputTokens": 21840,
        "outputTokens": 229,
        "reasoningTokens": 114
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:26"
    }
  },
  {
    "method": "item/started",
    "params": {
      "item": {
        "args": "{\"questions\":[{\"header\":\"Color\",\"id\":\"color_pref\",\"options\":[{\"label\":\"Red\"},{\"label\":\"Blue\"}],\"question\":\"Which color do you prefer?\",\"selection\":{\"mode\":\"single\"}}]}",
        "callId": "call_01a090c4bf2170f0bcf44050dfb432ed",
        "itemId": "01a090c4-c310-73c1-871b-2b08dd18070f",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T14:00:09.242998Z",
        "revision": 1,
        "status": "inProgress",
        "tool": "request_user_input",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:27"
    }
  },
  {
    "method": "userInput/requested",
    "params": {
      "itemId": "01a090c4-c310-73c1-871b-2b08dd18070f",
      "questions": [
        {
          "header": "Color",
          "id": "color_pref",
          "options": [
            {
              "label": "Red"
            },
            {
              "label": "Blue"
            }
          ],
          "question": "Which color do you prefer?",
          "selection": {
            "mode": "single"
          }
        }
      ],
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "toolCallId": "call_01a090c4bf2170f0bcf44050dfb432ed",
      "toolName": "request_user_input",
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "userInputId": "01a090c4-c310-73c1-871b-2b08dd18070f",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:28"
    }
  },
  {
    "method": "userInput/settled",
    "params": {
      "answers": [
        {
          "questionId": "color_pref",
          "selectedLabel": "Blue"
        }
      ],
      "clarification": null,
      "decidedByCommandId": "01a090c4-eba1-7000-ac35-589ed041c07b",
      "outcome": "answered",
      "reason": null,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "userInputId": "01a090c4-c310-73c1-871b-2b08dd18070f",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:29"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "args": "{\"questions\":[{\"header\":\"Color\",\"id\":\"color_pref\",\"options\":[{\"label\":\"Red\"},{\"label\":\"Blue\"}],\"question\":\"Which color do you prefer?\",\"selection\":{\"mode\":\"single\"}}]}",
        "callId": "call_01a090c4bf2170f0bcf44050dfb432ed",
        "itemId": "01a090c4-c310-73c1-871b-2b08dd18070f",
        "kind": "toolCall",
        "recordedAt": "2026-09-11T14:00:09.261092Z",
        "revision": 2,
        "status": "completed",
        "tool": "request_user_input",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
        "visibleOutput": "{\"status\":\"answered\",\"answers\":[{\"id\":\"color_pref\",\"selected_label\":\"Blue\"}]}"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:30"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "itemId": "55af1d46-e143-4d80-bf8b-2e6eeb225080",
        "kind": "agentMessage",
        "recordedAt": "2026-09-11T14:00:12.470986Z",
        "revision": 1,
        "status": "completed",
        "text": "Blue",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:31"
    }
  },
  {
    "method": "session/tokenUsage",
    "params": {
      "cumulative": {
        "outputTokens": 717,
        "promptTokens": 107888,
        "totalTokens": 108605
      },
      "durationMs": 3315,
      "modelId": "muse-spark-1.3-contributor",
      "promptTokens": 22112,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "totalTokens": 22173,
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "usage": {
        "cacheReadTokens": 21745,
        "cacheWriteTokens": 0,
        "cachedTokens": 21745,
        "inputTokens": 22112,
        "outputTokens": 61,
        "reasoningTokens": 50
      },
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:32"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "bd446ab6-aacd-47c3-9798-cc9ecd3dcc3e",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "9483b954-03ff-4c6f-9a80-9a77bd4dd9fd",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T14:00:12.666708Z",
        "reminderAgentId": "goal-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-d066-7752-ba00-d7b2f8f65f7a",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:33"
    }
  },
  {
    "method": "item/completed",
    "params": {
      "item": {
        "childSessionId": "c2f54039-2b65-44a3-adcb-ac796f4ec438",
        "fallbackText": "Reminder child session",
        "generationId": 1,
        "itemId": "5c77cb75-5252-474b-8ca9-b648d61584a0",
        "kind": "reminderChild",
        "recordedAt": "2026-09-11T14:00:12.692815Z",
        "reminderAgentId": "verify-reminder",
        "revision": 1,
        "status": "completed",
        "taskId": "01a090c4-d081-72c2-8cda-763ed35935c7",
        "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead"
      },
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:34"
    }
  },
  {
    "method": "turn/completed",
    "params": {
      "durationMs": 73471,
      "sessionId": "01a090c3-7bfd-7783-a745-f0a4449690bc",
      "terminal": "completed",
      "timeToFirstTokenMs": 7137,
      "turnId": "01a090c4-dd69-7000-9595-de62e24b1ead",
      "viewCursor": "v:01a090c3-7bfd-7783-a745-f0a4449690bc:35"
    }
  }
];

export const modelList: unknown = {
  "models": [
    {
      "contextLimit": 1007997,
      "cost": null,
      "description": null,
      "displayLabel": "muse-spark-1.3",
      "isActive": false,
      "isDefault": false,
      "modelId": "muse-spark-1.3",
      "outputLimit": 128000,
      "profileId": "tbh",
      "providerId": "meta",
      "releaseDate": "2026-09-02"
    },
    {
      "contextLimit": 1007997,
      "cost": null,
      "description": "Your content, including inter-session messages, may be used for product improvement.",
      "displayLabel": "muse-spark-1.3-contributor",
      "isActive": false,
      "isDefault": true,
      "modelId": "muse-spark-1.3-contributor",
      "outputLimit": 128000,
      "profileId": "tbh",
      "providerId": "meta",
      "releaseDate": "2026-09-02"
    },
    {
      "contextLimit": 1007997,
      "cost": null,
      "description": null,
      "displayLabel": "muse-spark-1.2",
      "isActive": false,
      "isDefault": false,
      "modelId": "muse-spark-1.2",
      "outputLimit": 128000,
      "profileId": "tbh",
      "providerId": "meta",
      "releaseDate": "2026-08-05"
    },
    {
      "contextLimit": 1007997,
      "cost": null,
      "description": "Your content, including inter-session messages, may be used for product improvement.",
      "displayLabel": "muse-spark-1.2-contributor",
      "isActive": false,
      "isDefault": false,
      "modelId": "muse-spark-1.2-contributor",
      "outputLimit": 128000,
      "profileId": "tbh",
      "providerId": "meta",
      "releaseDate": "2026-08-05"
    }
  ],
  "profileId": "tbh",
  "providerId": "meta",
  "source": "providerCatalog"
};
