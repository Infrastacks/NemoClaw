// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseProxyLogLine } from "./proxy-parser.js";

describe("parseProxyLogLine", () => {
  it("parses an allow decision", () => {
    const line = "[2026-03-22T10:30:00Z] POLICY decision=allow policy=nim_service dest=nim-service.local:443 method=GET path=/v1/models";
    const result = parseProxyLogLine(line);
    expect(result).toEqual({
      timestamp: "2026-03-22T10:30:00Z",
      decision: "allow",
      policy: "nim_service",
      dest: "nim-service.local:443",
      method: "GET",
      path: "/v1/models",
    });
  });

  it("parses a deny decision", () => {
    const line = "[2026-03-22T10:31:00Z] POLICY decision=deny policy=egress_block dest=evil.com:80 method=POST path=/exfil";
    const result = parseProxyLogLine(line);
    expect(result).toEqual({
      timestamp: "2026-03-22T10:31:00Z",
      decision: "deny",
      policy: "egress_block",
      dest: "evil.com:80",
      method: "POST",
      path: "/exfil",
    });
  });

  it("returns null for non-policy lines", () => {
    expect(parseProxyLogLine("[2026-03-22T10:30:00Z] INFO started")).toBeNull();
    expect(parseProxyLogLine("")).toBeNull();
    expect(parseProxyLogLine("just some text")).toBeNull();
  });

  it("returns null for invalid decision values", () => {
    const line = "[2026-03-22T10:30:00Z] POLICY decision=maybe policy=test dest=x:80 method=GET path=/";
    expect(parseProxyLogLine(line)).toBeNull();
  });

  it("handles missing optional kv fields gracefully", () => {
    const line = "[2026-03-22T10:30:00Z] POLICY decision=allow";
    const result = parseProxyLogLine(line);
    expect(result).toEqual({
      timestamp: "2026-03-22T10:30:00Z",
      decision: "allow",
      policy: "",
      dest: "",
      method: "",
      path: "",
    });
  });

  it("trims whitespace from input", () => {
    const line = "  [2026-03-22T10:30:00Z] POLICY decision=deny policy=test dest=a:1 method=GET path=/  \n";
    const result = parseProxyLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.decision).toBe("deny");
  });
});
