.PHONY: lint format check test test-cov

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
	uv run --group test pytest --cov=orchestrator --cov=migrations --cov-report=term
