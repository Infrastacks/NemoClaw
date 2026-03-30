---
title:
  page: "Set Up the NemoClaw Telegram Bridge for Remote Agent Chat"
  nav: "Set Up Telegram Bridge"
description: "Forward messages between Telegram and the sandboxed OpenClaw agent."
keywords: ["nemoclaw telegram bridge", "telegram bot openclaw agent"]
topics: ["generative_ai", "ai_agents"]
tags: ["openclaw", "openshell", "telegram", "deployment", "nemoclaw"]
content:
  type: how_to
  difficulty: intermediate
  audience: ["developer", "engineer"]
status: published
---

<!--
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# Set Up the Telegram Bridge

Forward messages between a Telegram bot and the OpenClaw agent running inside the sandbox.
The Telegram bridge is an auxiliary service managed by `nemoclaw start`.

## Prerequisites

- A running NemoClaw sandbox, either local or remote.
- A Telegram bot token from [BotFather](https://t.me/BotFather).

## Create a Telegram Bot

Open Telegram and send `/newbot` to [@BotFather](https://t.me/BotFather).
Follow the prompts to create a bot and receive a bot token.

## Set the Environment Variables

Export the bot token and chat allowlist as environment variables:

```console
$ export TELEGRAM_BOT_TOKEN=<your-bot-token>
$ export ALLOWED_CHAT_IDS="123456789,987654321"
```

## Start Auxiliary Services

Start the Telegram bridge and other auxiliary services:

```console
$ nemoclaw start
```

The `start` command launches the following services:

- The Telegram bridge forwards messages between Telegram and the agent.
- The cloudflared tunnel provides external access to the sandbox.

The Telegram bridge starts only when both `TELEGRAM_BOT_TOKEN` and `ALLOWED_CHAT_IDS` are set.

## Verify the Services

Check that the Telegram bridge is running:

```console
$ nemoclaw status
```

The output shows the status of all auxiliary services.

## Send a Message

Open Telegram, find your bot, and send a message.
The bridge forwards the message to the OpenClaw agent inside the sandbox and returns the agent response.

## Restrict Access by Chat ID

`ALLOWED_CHAT_IDS` is required. Set it to a comma-separated list of exact Telegram chat IDs:

```console
$ export ALLOWED_CHAT_IDS="123456789,987654321"
$ nemoclaw start
```

Wildcard values such as `*` are rejected. Only explicitly listed chat IDs can interact with the bridge.

## Stop the Services

To stop the Telegram bridge and all other auxiliary services:

```console
$ nemoclaw stop
```

## Related Topics

- [Deploy NemoClaw to a Remote GPU Instance](deploy-to-remote-gpu.md) for remote deployment with Telegram support.
- [Commands](../reference/commands.md) for the full `start` and `stop` command reference.
