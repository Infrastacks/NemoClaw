// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { parseAllowedChats } = require("../scripts/telegram-bridge.js");

describe("telegram bridge allowlist parsing", () => {
  it("accepts exact numeric chat ids", () => {
    const allowed = parseAllowedChats("123456789,-987654321");
    assert.deepEqual([...allowed], ["123456789", "-987654321"]);
  });

  it("rejects missing allowlists", () => {
    assert.throws(
      () => parseAllowedChats(""),
      /ALLOWED_CHAT_IDS is required/,
    );
  });

  it("rejects wildcard and malformed entries", () => {
    assert.throws(
      () => parseAllowedChats("123,*"),
      /exact numeric chat IDs only/,
    );
    assert.throws(
      () => parseAllowedChats("123,abc"),
      /Invalid Telegram chat ID: abc/,
    );
  });
});
