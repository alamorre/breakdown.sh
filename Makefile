.PHONY: build lint typecheck test audit-high format check

build lint typecheck test check:
	pnpm run $@

audit-high:
	pnpm run audit:high

format:
	pnpm exec prettier --write .
