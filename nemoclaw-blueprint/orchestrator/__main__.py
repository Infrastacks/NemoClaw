# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Allow ``python -m orchestrator.server`` to start the API server."""

from orchestrator.server import start

if __name__ == "__main__":
    start()
