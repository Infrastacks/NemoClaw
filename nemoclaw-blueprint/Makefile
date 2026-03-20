.PHONY: lint format check test test-cov serve test-api test-all

lint:
	ruff check .

format:
	ruff format .
	ruff check --fix .

check:
	ruff check .
	ruff format --check .

test:
	uv run --group test pytest

test-cov:
	uv run --group api-test pytest --cov=orchestrator --cov=migrations --cov-report=term

serve:
	uv run --group api python -m orchestrator.server

test-api:
	uv run --group api-test pytest tests/test_api.py

test-all:
	uv run --group api-test pytest
