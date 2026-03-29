"""Tool implementations for the Codicera Agent Runtime.

Tools are plain Python operations. Sandboxing is enforced at the OS level
by OpenShell (Landlock, seccomp, OPA) — not by this code.
"""

from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from .types import HitlClass

# ---------------------------------------------------------------------------
# Tool definition
# ---------------------------------------------------------------------------


@dataclass
class ToolDef:
    """A registered tool: handler + OpenAI function schema."""

    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., Awaitable[str]]


# ---------------------------------------------------------------------------
# Four-tier HITL classification (per-tool)
# ---------------------------------------------------------------------------

TOOL_HITL_CLASS: dict[str, HitlClass] = {
    "file_read": HitlClass.READ_ONLY,
    "list_dir": HitlClass.READ_ONLY,
    "shell_read": HitlClass.READ_ONLY,
    "web_search": HitlClass.READ_ONLY,
    "secret_read": HitlClass.READ_ONLY,
    "memory_store": HitlClass.READ_ONLY,
    "memory_search": HitlClass.READ_ONLY,
    "file_write": HitlClass.REVERSIBLE,
    "shell_exec": HitlClass.SIDE_EFFECT,
    "http_fetch": HitlClass.SIDE_EFFECT,
    "git_op": HitlClass.SIDE_EFFECT,
    "db_query": HitlClass.SIDE_EFFECT,
    "image_view": HitlClass.READ_ONLY,
    "artifact_upload": HitlClass.SIDE_EFFECT,
    "browser_action": HitlClass.SIDE_EFFECT,
}

# Backward compat: computed from TOOL_HITL_CLASS
SIDE_EFFECT_TOOLS: set[str] = {
    k for k, v in TOOL_HITL_CLASS.items()
    if v in (HitlClass.SIDE_EFFECT, HitlClass.DESTRUCTIVE)
}

# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


async def _file_read(path: str) -> str:
    """Read and return the contents of a file."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.read()
        # Truncate very large files to avoid blowing context
        if len(content) > 100_000:
            return content[:100_000] + "\n\n... [truncated at 100 000 chars]"
        return content
    except Exception as exc:
        return f"error: {exc}"


async def _file_write(path: str, content: str) -> str:
    """Write content to a file, creating parent directories as needed."""
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"wrote {len(content)} bytes to {path}"
    except Exception as exc:
        return f"error: {exc}"


async def _shell_exec(command: str, timeout: int = 30) -> str:
    """Execute a shell command and return combined stdout/stderr."""
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=os.environ.get("CAR_WORKSPACE", "/workspace"),
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return f"error: command timed out after {timeout}s"
        output = stdout.decode("utf-8", errors="replace") if stdout else ""
        if proc.returncode != 0:
            output += f"\n[exit code {proc.returncode}]"
        # Truncate very long output
        if len(output) > 50_000:
            output = output[:50_000] + "\n\n... [truncated at 50 000 chars]"
        return output
    except Exception as exc:
        return f"error: {exc}"


async def _http_fetch(
    url: str, method: str = "GET", body: str | None = None
) -> str:
    """Perform an HTTP request and return the response body."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.request(
                method.upper(),
                url,
                content=body.encode("utf-8") if body else None,
            )
        text = response.text
        if len(text) > 50_000:
            text = text[:50_000] + "\n\n... [truncated at 50 000 chars]"
        return f"HTTP {response.status_code}\n{text}"
    except Exception as exc:
        return f"error: {exc}"


async def _list_dir(path: str = ".") -> str:
    """List directory contents."""
    try:
        entries = sorted(os.listdir(path))
        if not entries:
            return "(empty directory)"
        return "\n".join(entries)
    except Exception as exc:
        return f"error: {exc}"


# -- shell_read: read-only shell commands (no HITL gating) -----------------

READ_ONLY_PREFIXES: set[str] = {
    "ls", "cat", "head", "tail", "grep", "find", "wc", "du", "df", "file",
    "stat", "readlink", "which", "type", "echo", "printf", "date", "whoami",
    "hostname", "uname", "env", "printenv", "pwd", "id",
    "git log", "git diff", "git status", "git show", "git branch", "git tag",
    "git rev-parse", "git remote", "git config --get",
    "python --version", "python3 --version", "pip list", "pip show",
    "node --version", "npm list", "npm --version",
    "ps", "top -b -n1", "free", "uptime",
}


_SHELL_METACHAR = re.compile(r'[;&|`$><]')


def _is_read_only_command(command: str) -> bool:
    """Check whether a command matches the read-only allowlist.

    Rejects commands containing shell metacharacters to prevent chaining.
    """
    stripped = command.strip()
    if _SHELL_METACHAR.search(stripped):
        return False
    for prefix in READ_ONLY_PREFIXES:
        if stripped == prefix or stripped.startswith(prefix + " "):
            return True
    return False


async def _shell_read(command: str, timeout: int = 30) -> str:
    """Execute a read-only shell command. Rejects mutating commands."""
    if not _is_read_only_command(command):
        return (
            f"error: command not on the read-only allowlist. "
            f"Use shell_exec for mutating commands."
        )
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=os.environ.get("CAR_WORKSPACE", "/workspace"),
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return f"error: command timed out after {timeout}s"
        output = stdout.decode("utf-8", errors="replace") if stdout else ""
        if proc.returncode != 0:
            output += f"\n[exit code {proc.returncode}]"
        if len(output) > 50_000:
            output = output[:50_000] + "\n\n... [truncated at 50 000 chars]"
        return output
    except Exception as exc:
        return f"error: {exc}"


# -- web_search: multi-provider (Brave / Bing) ----------------------------


def _format_search_results(results: list[dict]) -> str:
    """Format search results uniformly across providers."""
    lines: list[str] = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r.get('title', r.get('name', ''))}")
        lines.append(f"   {r.get('url', '')}")
        snippet = r.get("description", r.get("snippet", ""))
        if snippet:
            lines.append(f"   {snippet}")
        lines.append("")
    return "\n".join(lines).strip()


async def _web_search_brave(query: str, count: int) -> str:
    """Search via Brave Search API."""
    api_key = os.environ.get("BRAVE_SEARCH_API_KEY")
    if not api_key:
        return "error: BRAVE_SEARCH_API_KEY not configured. Add a Brave Search provider in Settings > Service Providers."
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": count},
            headers={
                "X-Subscription-Token": api_key,
                "Accept": "application/json",
            },
        )
        resp.raise_for_status()
    data = resp.json()
    results = data.get("web", {}).get("results", [])
    if not results:
        return "No results found."
    return _format_search_results(results)


async def _web_search_bing(query: str, count: int) -> str:
    """Search via Bing Search API v7."""
    api_key = os.environ.get("BING_SEARCH_API_KEY")
    if not api_key:
        return "error: BING_SEARCH_API_KEY not configured. Add a Bing Search provider in Settings > Service Providers."
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.bing.microsoft.com/v7.0/search",
            params={"q": query, "count": count, "mkt": "en-US"},
            headers={"Ocp-Apim-Subscription-Key": api_key},
        )
        resp.raise_for_status()
    data = resp.json()
    results = data.get("webPages", {}).get("value", [])
    if not results:
        return "No results found."
    return _format_search_results(results)


_WEB_SEARCH_PROVIDERS: dict[str, Any] = {
    "brave": _web_search_brave,
    "bing": _web_search_bing,
}


async def _web_search(query: str, count: int = 5) -> str:
    """Search the web via configured provider (Brave or Bing)."""
    count = min(max(count, 1), 10)
    provider = os.environ.get("WEB_SEARCH_PROVIDER", "brave").lower()
    handler = _WEB_SEARCH_PROVIDERS.get(provider)
    if handler is None:
        return f"error: unknown web search provider '{provider}', expected: {', '.join(_WEB_SEARCH_PROVIDERS)}"
    try:
        return await handler(query, count)
    except Exception as exc:
        return f"error: {exc}"


# -- secret_read: read a named secret from the sandbox vault ---------------

async def _secret_read(name: str) -> str:
    """Read a named secret from the sandbox secrets directory."""
    from .secrets import read_secret

    try:
        return await read_secret(name)
    except ValueError as exc:
        return f"error: {exc}"
    except Exception as exc:
        return f"error: {exc}"


# -- git_op: structured git operations -------------------------------------

async def _git_op(operation: str, args: str = "") -> str:
    """Execute a structured git operation in the workspace.

    Uses create_subprocess_exec (not shell) with shlex.split to prevent injection.
    """
    operation = operation.strip().lower()
    allowed = {
        "clone", "diff", "log", "status", "show", "branch", "tag",
        "rev-parse", "remote", "commit", "push", "pull", "add", "checkout",
    }
    if operation not in allowed:
        return f"error: unsupported git operation '{operation}'. Allowed: {sorted(allowed)}"

    cmd_parts = ["git", operation]
    if args:
        try:
            cmd_parts.extend(shlex.split(args))
        except ValueError as exc:
            return f"error: invalid arguments: {exc}"

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd_parts,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            cwd=os.environ.get("CAR_WORKSPACE", "/workspace"),
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return f"error: git {operation} timed out after 60s"
        output = stdout.decode("utf-8", errors="replace") if stdout else ""
        if proc.returncode != 0:
            output += f"\n[exit code {proc.returncode}]"
        if len(output) > 50_000:
            output = output[:50_000] + "\n\n... [truncated at 50 000 chars]"
        return output
    except Exception as exc:
        return f"error: {exc}"


# -- db_query: execute SQL against a configured database -------------------

async def _db_query(query: str, connection_name: str = "default") -> str:
    """Execute a SQL query using a DSN from the sandbox secrets."""
    from .secrets import read_secret

    try:
        dsn = await read_secret(f"{connection_name}_db_url")
    except ValueError:
        return f"error: database connection '{connection_name}' not configured (secret '{connection_name}_db_url' not found)"

    try:
        import asyncpg  # noqa: F811
    except ImportError:
        return "error: asyncpg not installed — db_query requires the asyncpg package"

    try:
        conn = await asyncpg.connect(dsn)
        try:
            rows = await conn.fetch(query)
            if not rows:
                return "(no rows returned)"
            # Format as JSON array
            result = json.dumps([dict(r) for r in rows], default=str, indent=2)
            if len(result) > 50_000:
                result = result[:50_000] + "\n\n... [truncated at 50 000 chars]"
            return result
        finally:
            await conn.close()
    except Exception as exc:
        return f"error: {exc}"


# ---------------------------------------------------------------------------
# OpenAI-compatible function schemas
# ---------------------------------------------------------------------------

_FILE_READ_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Absolute or relative file path to read."},
    },
    "required": ["path"],
    "additionalProperties": False,
}

_FILE_WRITE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "File path to write to."},
        "content": {"type": "string", "description": "Content to write."},
    },
    "required": ["path", "content"],
    "additionalProperties": False,
}

_SHELL_EXEC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "command": {"type": "string", "description": "Shell command to execute."},
        "timeout": {
            "type": "integer",
            "description": "Timeout in seconds (default 30).",
            "default": 30,
        },
    },
    "required": ["command"],
    "additionalProperties": False,
}

_HTTP_FETCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "url": {"type": "string", "description": "URL to fetch."},
        "method": {
            "type": "string",
            "description": "HTTP method (default GET).",
            "default": "GET",
        },
        "body": {
            "type": "string",
            "description": "Optional request body.",
        },
    },
    "required": ["url"],
    "additionalProperties": False,
}

_LIST_DIR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {
            "type": "string",
            "description": "Directory path to list (default '.').",
            "default": ".",
        },
    },
    "required": [],
    "additionalProperties": False,
}

_SHELL_READ_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "command": {
            "type": "string",
            "description": "Read-only shell command (e.g. ls, cat, grep, git log, git diff, ps).",
        },
        "timeout": {
            "type": "integer",
            "description": "Timeout in seconds (default 30).",
            "default": 30,
        },
    },
    "required": ["command"],
    "additionalProperties": False,
}

_WEB_SEARCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Search query."},
        "count": {
            "type": "integer",
            "description": "Number of results to return (default 5, max 10).",
            "default": 5,
        },
    },
    "required": ["query"],
    "additionalProperties": False,
}

_SECRET_READ_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "Name of the secret to read."},
    },
    "required": ["name"],
    "additionalProperties": False,
}

_GIT_OP_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "operation": {
            "type": "string",
            "description": "Git operation: clone, diff, log, status, show, branch, tag, commit, push, pull, add, checkout.",
        },
        "args": {
            "type": "string",
            "description": "Additional arguments for the git command.",
            "default": "",
        },
    },
    "required": ["operation"],
    "additionalProperties": False,
}

_DB_QUERY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "SQL query to execute."},
        "connection_name": {
            "type": "string",
            "description": "Named database connection (reads DSN from secret '{name}_db_url'). Default: 'default'.",
            "default": "default",
        },
    },
    "required": ["query"],
    "additionalProperties": False,
}


# -- image_view: describe an image via a vision model -----------------------

async def _image_view(
    path: str, prompt: str = "Describe this image in detail."
) -> str:
    """View and describe an image file using a vision model."""
    p = Path(path)
    if not p.is_file():
        return f"error: file not found: {path}"

    ext = p.suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
        return f"error: unsupported image format '{ext}'"

    data = p.read_bytes()
    if len(data) > 20 * 1024 * 1024:
        return "error: image exceeds 20 MB size limit"

    b64 = base64.b64encode(data).decode("ascii")
    # Strip the leading dot for the MIME subtype
    mime_ext = ext.lstrip(".")
    if mime_ext == "jpg":
        mime_ext = "jpeg"

    endpoint = os.environ.get("INFERENCE_ENDPOINT", "")
    api_key = os.environ.get("INFERENCE_API_KEY", "")
    model = os.environ.get("INFERENCE_VISION_MODEL", "gpt-4o")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{endpoint}/chat/completions",
                headers={
                    "api-key": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/{mime_ext};base64,{b64}"
                                    },
                                },
                            ],
                        }
                    ],
                },
            )
            resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        return f"error: {exc}"


_IMAGE_VIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Path to image file in the sandbox."},
        "prompt": {
            "type": "string",
            "description": "What to extract or describe from the image.",
            "default": "Describe this image in detail.",
        },
    },
    "required": ["path"],
    "additionalProperties": False,
}


# -- artifact_upload: upload a file to artifact storage ---------------------

async def _artifact_upload(
    path: str, name: str | None = None, content_type: str | None = None
) -> str:
    """Upload a file from the sandbox to artifact storage."""
    p = Path(path)
    if not p.is_file():
        return f"error: file not found: {path}"

    data = p.read_bytes()
    if len(data) > 100 * 1024 * 1024:
        return "error: file exceeds 100 MB size limit"

    if content_type is None:
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

    name = name or p.name

    endpoint = os.environ.get("CAR_ARTIFACT_ENDPOINT", "")
    if not endpoint:
        return "error: CAR_ARTIFACT_ENDPOINT not configured"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.put(
                f"{endpoint}/{name}",
                headers={
                    "Content-Type": content_type,
                    "x-ms-blob-type": "BlockBlob",
                },
                content=data,
            )
        if resp.status_code >= 400:
            return f"error: upload failed with status {resp.status_code}"
        return json.dumps({
            "url": f"{endpoint}/{name}",
            "name": name,
            "size": len(data),
            "contentType": content_type,
        })
    except Exception as exc:
        return f"error: {exc}"


_ARTIFACT_UPLOAD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Path to file to upload."},
        "name": {"type": "string", "description": "Display name for the artifact (defaults to filename)."},
        "content_type": {"type": "string", "description": "MIME type (auto-detected if omitted)."},
    },
    "required": ["path"],
    "additionalProperties": False,
}

# -- browser_action: headless browser automation (optional Playwright) ------

_BROWSER_PAGE = None  # lazy-init: playwright Page instance


async def _browser_action(
    action: str,
    url: str | None = None,
    selector: str | None = None,
    text: str | None = None,
) -> str:
    """Perform a headless browser action using Playwright (if installed)."""
    global _BROWSER_PAGE

    try:
        from playwright.async_api import async_playwright  # noqa: F811
    except ImportError:
        return (
            "error: playwright is not installed in this sandbox. "
            "Install it with: pip install playwright && playwright install chromium"
        )

    # Lazy-init browser
    if _BROWSER_PAGE is None:
        pw = await async_playwright().start()
        browser = await pw.chromium.launch(headless=True)
        _BROWSER_PAGE = await browser.new_page()

    page = _BROWSER_PAGE
    timeout = 30_000  # ms

    try:
        if action == "navigate":
            if not url:
                return "error: 'url' is required for navigate action"
            resp = await page.goto(url, timeout=timeout, wait_until="domcontentloaded")
            status = resp.status if resp else "unknown"
            return json.dumps({"title": await page.title(), "url": page.url, "status": status})

        elif action == "click":
            if not selector:
                return "error: 'selector' is required for click action"
            await page.click(selector, timeout=timeout)
            return f"Clicked element: {selector}"

        elif action == "type":
            if not selector or text is None:
                return "error: 'selector' and 'text' are required for type action"
            await page.fill(selector, text, timeout=timeout)
            return f"Typed into {selector}"

        elif action == "screenshot":
            ts = int(asyncio.get_event_loop().time() * 1000)
            screenshot_path = f"/tmp/screenshot_{ts}.png"
            await page.screenshot(path=screenshot_path, full_page=True, timeout=timeout)
            return json.dumps({"path": screenshot_path, "url": page.url})

        elif action == "extract_text":
            if selector:
                el = await page.query_selector(selector)
                if el is None:
                    return f"error: element not found: {selector}"
                content = await el.text_content() or ""
            else:
                content = await page.inner_text("body", timeout=timeout)
            # Truncate to avoid flooding context
            if len(content) > 10_000:
                content = content[:10_000] + "\n... (truncated)"
            return content

        elif action == "wait":
            if not selector:
                return "error: 'selector' is required for wait action"
            await page.wait_for_selector(selector, timeout=10_000)
            return f"Element appeared: {selector}"

        else:
            return f"error: unknown action '{action}'. Expected: navigate, click, type, screenshot, extract_text, wait"
    except Exception as exc:
        return f"error: {exc}"


_BROWSER_ACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["navigate", "click", "type", "screenshot", "extract_text", "wait"],
            "description": "Browser action to perform.",
        },
        "url": {"type": "string", "description": "URL to navigate to (for navigate action)."},
        "selector": {"type": "string", "description": "CSS selector for the target element."},
        "text": {"type": "string", "description": "Text to type (for type action)."},
    },
    "required": ["action"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, ToolDef] = {
    "file_read": ToolDef(
        name="file_read",
        description="Read the contents of a file.",
        parameters=_FILE_READ_SCHEMA,
        handler=_file_read,
    ),
    "file_write": ToolDef(
        name="file_write",
        description="Write content to a file, creating directories as needed.",
        parameters=_FILE_WRITE_SCHEMA,
        handler=_file_write,
    ),
    "shell_exec": ToolDef(
        name="shell_exec",
        description="Execute a shell command and return its output.",
        parameters=_SHELL_EXEC_SCHEMA,
        handler=_shell_exec,
    ),
    "http_fetch": ToolDef(
        name="http_fetch",
        description="Fetch a URL via HTTP and return the response.",
        parameters=_HTTP_FETCH_SCHEMA,
        handler=_http_fetch,
    ),
    "list_dir": ToolDef(
        name="list_dir",
        description="List files and directories at a path.",
        parameters=_LIST_DIR_SCHEMA,
        handler=_list_dir,
    ),
    "shell_read": ToolDef(
        name="shell_read",
        description=(
            "Execute a read-only shell command (ls, cat, grep, git log, git diff, ps, etc.) "
            "without requiring approval. Use shell_exec for mutating commands."
        ),
        parameters=_SHELL_READ_SCHEMA,
        handler=_shell_read,
    ),
    "web_search": ToolDef(
        name="web_search",
        description="Search the web and return results with titles, URLs, and snippets.",
        parameters=_WEB_SEARCH_SCHEMA,
        handler=_web_search,
    ),
    "secret_read": ToolDef(
        name="secret_read",
        description="Read a named secret from the sandbox vault. Use for API keys, tokens, and credentials.",
        parameters=_SECRET_READ_SCHEMA,
        handler=_secret_read,
    ),
    "git_op": ToolDef(
        name="git_op",
        description=(
            "Execute a structured git operation: clone, diff, log, status, show, "
            "branch, tag, commit, push, pull, add, checkout."
        ),
        parameters=_GIT_OP_SCHEMA,
        handler=_git_op,
    ),
    "db_query": ToolDef(
        name="db_query",
        description="Execute a SQL query against a configured database connection.",
        parameters=_DB_QUERY_SCHEMA,
        handler=_db_query,
    ),
    "image_view": ToolDef(
        name="image_view",
        description="View and describe an image file using a vision model.",
        parameters=_IMAGE_VIEW_SCHEMA,
        handler=_image_view,
    ),
    "artifact_upload": ToolDef(
        name="artifact_upload",
        description="Upload a file from the sandbox to artifact storage.",
        parameters=_ARTIFACT_UPLOAD_SCHEMA,
        handler=_artifact_upload,
    ),
    "browser_action": ToolDef(
        name="browser_action",
        description=(
            "Perform a headless browser action (navigate, click, type, screenshot, "
            "extract_text, wait). Requires Playwright to be installed in the sandbox."
        ),
        parameters=_BROWSER_ACTION_SCHEMA,
        handler=_browser_action,
    ),
}


def openai_tool_definitions() -> list[dict[str, Any]]:
    """Return tool definitions in OpenAI function-calling format (builtin tools only)."""
    return openai_tool_definitions_from(TOOL_REGISTRY)


def openai_tool_definitions_from(registry: dict[str, ToolDef]) -> list[dict[str, Any]]:
    """Return tool definitions in OpenAI function-calling format from a given registry."""
    return [
        {
            "type": "function",
            "function": {
                "name": td.name,
                "description": td.description,
                "parameters": td.parameters,
            },
        }
        for td in registry.values()
    ]


async def execute_tool(name: str, args: dict[str, Any]) -> str:
    """Look up and execute a builtin tool by name."""
    return await execute_tool_from(TOOL_REGISTRY, name, args)


async def execute_tool_from(
    registry: dict[str, ToolDef], name: str, args: dict[str, Any]
) -> str:
    """Look up and execute a tool by name from a given registry."""
    tool_def = registry.get(name)
    if tool_def is None:
        return f"error: unknown tool '{name}'"
    try:
        return await tool_def.handler(**args)
    except TypeError as exc:
        return f"error: invalid arguments for {name}: {exc}"
