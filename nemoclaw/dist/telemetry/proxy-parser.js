"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProxyLogLine = parseProxyLogLine;
exports.emitProxyLineEvents = emitProxyLineEvents;
const types_js_1 = require("./types.js");
const DECISION_RE = /^\[(?<ts>[^\]]+)\]\s+POLICY\s+(?<kvs>.+)$/;
const KV_RE = /(\w+)=(\S+)/g;
function parseProxyLogLine(line) {
    const trimmed = line.trim();
    const m = DECISION_RE.exec(trimmed);
    if (!m?.groups)
        return null;
    const kvs = {};
    for (const [, key, value] of m.groups.kvs.matchAll(KV_RE)) {
        kvs[key] = value;
    }
    const decision = kvs.decision;
    if (decision !== "allow" && decision !== "deny")
        return null;
    return {
        timestamp: m.groups.ts,
        decision,
        policy: kvs.policy ?? "",
        dest: kvs.dest ?? "",
        method: kvs.method ?? "",
        path: kvs.path ?? "",
    };
}
/**
 * Parse a proxy log line and emit the corresponding policy + network telemetry events.
 * Returns the parsed decision (or null if the line was not a policy line).
 */
function emitProxyLineEvents(emitter, line) {
    const parsed = parseProxyLogLine(line);
    if (!parsed)
        return null;
    const data = {
        source: "openshell",
        policy: parsed.policy,
        rule_id: parsed.policy,
        dest: parsed.dest,
        method: parsed.method,
        path: parsed.path,
        timestamp: parsed.timestamp,
    };
    if (parsed.decision === "allow") {
        emitter.emit(types_js_1.POLICY_EVALUATED, data);
        emitter.emit(types_js_1.NETWORK_APPROVED, data);
    }
    else {
        const denyData = { ...data, reason: `Policy denied by ${parsed.policy}` };
        emitter.emit(types_js_1.POLICY_DENIED, denyData);
        emitter.emit(types_js_1.NETWORK_DENIED, denyData);
    }
    return parsed;
}
//# sourceMappingURL=proxy-parser.js.map