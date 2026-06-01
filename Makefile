.PHONY: dev build lint typecheck test test-coverage audit-high format check

dev:
	pnpm run dev

build:
	pnpm run build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm run test

test-coverage:
	pnpm run test:coverage

audit-high:
	pnpm run audit:high

format:
	pnpm exec prettier --write .

check: lint typecheck test-coverage build
