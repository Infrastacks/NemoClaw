"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSink = exports.StdoutSink = void 0;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
class StdoutSink {
    write(event) {
        process.stdout.write(JSON.stringify(event) + "\n");
    }
}
exports.StdoutSink = StdoutSink;
class FileSink {
    path;
    constructor(path) {
        this.path = path ?? (0, node_path_1.join)((0, node_os_1.homedir)(), ".nemoclaw", "events.jsonl");
    }
    write(event) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.path), { recursive: true });
        (0, node_fs_1.appendFileSync)(this.path, JSON.stringify(event) + "\n");
    }
}
exports.FileSink = FileSink;
//# sourceMappingURL=sinks.js.map