#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Telegram → NemoClaw bridge.
 *
 * Messages from Telegram are forwarded to the OpenClaw agent running
 * inside the sandbox. When the agent needs external access, the
 * OpenShell TUI lights up for approval. Responses go back to Telegram.
 *
 * Env:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   NVIDIA_API_KEY      — for inference
 *   SANDBOX_NAME        — sandbox name (default: nemoclaw)
 *   ALLOWED_CHAT_IDS    — required comma-separated Telegram chat IDs to accept
 */

const https = require("https");
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const { resolveOpenshell } = require("../bin/lib/resolve-openshell");

function parseAllowedChats(raw) {
  if (!raw || !raw.trim()) {
    throw new Error("ALLOWED_CHAT_IDS is required and must list one or more Telegram chat IDs.");
  }

  const entries = raw.split(",");
  const chatIds = [];
  for (const entry of entries) {
    const value = entry.trim();
    if (!value || value === "*") {
      throw new Error("ALLOWED_CHAT_IDS must contain exact numeric chat IDs only.");
    }
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`Invalid Telegram chat ID: ${value}`);
    }
    chatIds.push(value);
  }

  return new Set(chatIds);
}

function loadConfig(env = process.env) {
  const openshell = resolveOpenshell();
  if (!openshell) {
    throw new Error("openshell not found on PATH or in common locations");
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const apiKey = env.NVIDIA_API_KEY;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN required");
  if (!apiKey) throw new Error("NVIDIA_API_KEY required");

  return {
    openshell,
    token,
    apiKey,
    sandbox: env.SANDBOX_NAME || "nemoclaw",
    allowedChats: parseAllowedChats(env.ALLOWED_CHAT_IDS),
  };
}

let offset = 0;

// ── Telegram API helpers ──────────────────────────────────────────

function tgApi(config, method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${config.token}/${method}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, error: buf }); }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function sendMessage(config, chatId, text, replyTo) {
  // Telegram max message length is 4096
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) {
    chunks.push(text.slice(i, i + 4000));
  }
  for (const chunk of chunks) {
    await tgApi(config, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      reply_to_message_id: replyTo,
      parse_mode: "Markdown",
    }).catch(() =>
      // Retry without markdown if it fails (unbalanced formatting)
      tgApi(config, "sendMessage", { chat_id: chatId, text: chunk, reply_to_message_id: replyTo }),
    );
  }
}

async function sendTyping(config, chatId) {
  await tgApi(config, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

// ── Run agent inside sandbox ──────────────────────────────────────

function runAgentInSandbox(config, message, sessionId) {
  return new Promise((resolve) => {
    const sshConfig = execSync(`"${config.openshell}" sandbox ssh-config "${config.sandbox}"`, { encoding: "utf-8" });

    // Write temp ssh config
    const confPath = `/tmp/nemoclaw-tg-ssh-${sessionId}.conf`;
    fs.writeFileSync(confPath, sshConfig);

    const escaped = message.replace(/'/g, "'\\''");
    const cmd = `export NVIDIA_API_KEY='${config.apiKey}' && nemoclaw-start openclaw agent --agent main --local -m '${escaped}' --session-id 'tg-${sessionId}'`;

    const proc = spawn("ssh", ["-T", "-F", confPath, `openshell-${config.sandbox}`, cmd], {
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { fs.unlinkSync(confPath); } catch {}

      // Extract the actual agent response — skip setup lines
      const lines = stdout.split("\n");
      const responseLines = lines.filter(
        (l) =>
          !l.startsWith("Setting up NemoClaw") &&
          !l.startsWith("[plugins]") &&
          !l.startsWith("(node:") &&
          !l.includes("NemoClaw ready") &&
          !l.includes("NemoClaw registered") &&
          !l.includes("openclaw agent") &&
          !l.includes("┌─") &&
          !l.includes("│ ") &&
          !l.includes("└─") &&
          l.trim() !== "",
      );

      const response = responseLines.join("\n").trim();

      if (response) {
        resolve(response);
      } else if (code !== 0) {
        resolve(`Agent exited with code ${code}. ${stderr.trim().slice(0, 500)}`);
      } else {
        resolve("(no response)");
      }
    });

    proc.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });
  });
}

// ── Poll loop ─────────────────────────────────────────────────────

async function poll(config) {
  try {
    const res = await tgApi(config, "getUpdates", { offset, timeout: 30 });

    if (res.ok && res.result?.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;

        const msg = update.message;
        if (!msg?.text) continue;

        const chatId = String(msg.chat.id);

        // Access control
        if (!config.allowedChats.has(chatId)) {
          console.log(`[ignored] chat ${chatId} not in allowed list`);
          continue;
        }

        const userName = msg.from?.first_name || "someone";
        console.log(`[${chatId}] ${userName}: ${msg.text}`);

        // Handle /start
        if (msg.text === "/start") {
          await sendMessage(
            config,
            chatId,
            "🦀 *NemoClaw* — powered by Nemotron 3 Super 120B\n\n" +
              "Send me a message and I'll run it through the OpenClaw agent " +
              "inside an OpenShell sandbox.\n\n" +
              "If the agent needs external access, the TUI will prompt for approval.",
            msg.message_id,
          );
          continue;
        }

        // Handle /reset
        if (msg.text === "/reset") {
          await sendMessage(config, chatId, "Session reset.", msg.message_id);
          continue;
        }

        // Send typing indicator
        await sendTyping(config, chatId);

        // Keep a typing indicator going while agent runs
        const typingInterval = setInterval(() => sendTyping(config, chatId), 4000);

        try {
          const response = await runAgentInSandbox(config, msg.text, chatId);
          clearInterval(typingInterval);
          console.log(`[${chatId}] agent: ${response.slice(0, 100)}...`);
          await sendMessage(config, chatId, response, msg.message_id);
        } catch (err) {
          clearInterval(typingInterval);
          await sendMessage(config, chatId, `Error: ${err.message}`, msg.message_id);
        }
      }
    }
  } catch (err) {
    console.error("Poll error:", err.message);
  }

  // Continue polling
  setTimeout(() => poll(config), 100);
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  console.log(`[telegram] allowlisted chat IDs: ${config.allowedChats.size}`);

  const me = await tgApi(config, "getMe", {});
  if (!me.ok) {
    console.error("Failed to connect to Telegram:", JSON.stringify(me));
    process.exit(1);
  }

  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  NemoClaw Telegram Bridge                          │");
  console.log("  │                                                     │");
  console.log(`  │  Bot:      @${(me.result.username + "                    ").slice(0, 37)}│`);
  console.log("  │  Sandbox:  " + (config.sandbox + "                              ").slice(0, 40) + "│");
  console.log("  │  Model:    nvidia/nemotron-3-super-120b-a12b       │");
  console.log("  │                                                     │");
  console.log("  │  Messages are forwarded to the OpenClaw agent      │");
  console.log("  │  inside the sandbox. Run 'openshell term' in       │");
  console.log("  │  another terminal to monitor + approve egress.     │");
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log("");

  poll(config);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

module.exports = {
  loadConfig,
  parseAllowedChats,
};
