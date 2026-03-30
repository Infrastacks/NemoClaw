"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelemetryEmitter = void 0;
const types_js_1 = require("./types.js");
class TelemetryEmitter {
    sandboxId;
    sinks;
    constructor(opts) {
        this.sandboxId = opts?.sandboxId ?? "";
        this.sinks = opts?.sinks ?? [];
    }
    emit(eventType, data) {
        const event = {
            schemaVersion: types_js_1.SCHEMA_VERSION,
            eventType,
            sandboxId: this.sandboxId,
            timestamp: new Date().toISOString(),
            data: data ?? {},
        };
        for (const sink of this.sinks) {
            sink.write(event);
        }
    }
}
exports.TelemetryEmitter = TelemetryEmitter;
//# sourceMappingURL=emitter.js.map