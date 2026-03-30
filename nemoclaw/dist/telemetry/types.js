"use strict";
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_HEARTBEAT = exports.NETWORK_DISCONNECTED = exports.NETWORK_CONNECTED = exports.NETWORK_DENIED = exports.NETWORK_APPROVED = exports.POLICY_DENIED = exports.POLICY_EVALUATED = exports.POLICY_APPLIED = exports.INFERENCE_ERROR = exports.INFERENCE_RESPONSE = exports.INFERENCE_REQUEST = exports.INFERENCE_CONFIGURED = exports.RUN_ID = exports.SANDBOX_ERROR = exports.SANDBOX_DESTROYED = exports.SANDBOX_CREATED = exports.SANDBOX_PLANNED = exports.SANDBOX_PROGRESS = exports.SCHEMA_VERSION = void 0;
exports.SCHEMA_VERSION = "1.0";
// Sandbox lifecycle
exports.SANDBOX_PROGRESS = "sandbox.progress";
exports.SANDBOX_PLANNED = "sandbox.planned";
exports.SANDBOX_CREATED = "sandbox.created";
exports.SANDBOX_DESTROYED = "sandbox.destroyed";
exports.SANDBOX_ERROR = "sandbox.error";
exports.RUN_ID = "run.id";
// Inference lifecycle
exports.INFERENCE_CONFIGURED = "inference.configured";
exports.INFERENCE_REQUEST = "inference.request";
exports.INFERENCE_RESPONSE = "inference.response";
exports.INFERENCE_ERROR = "inference.error";
// Policy lifecycle
exports.POLICY_APPLIED = "policy.applied";
exports.POLICY_EVALUATED = "policy.evaluated";
exports.POLICY_DENIED = "policy.denied";
// Network lifecycle
exports.NETWORK_APPROVED = "network.approved";
exports.NETWORK_DENIED = "network.denied";
exports.NETWORK_CONNECTED = "network.connected";
exports.NETWORK_DISCONNECTED = "network.disconnected";
// Agent lifecycle
exports.AGENT_HEARTBEAT = "agent.heartbeat";
//# sourceMappingURL=types.js.map