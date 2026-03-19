.PHONY: dev build lint typecheck test format check

dev:
	npx next dev

build:
	npx next build

lint:
	npx eslint .

typecheck:
	npx tsc --noEmit

test:
	npx vitest run

format:
	npx prettier --write .

check: lint typecheck test
