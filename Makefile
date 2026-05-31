.PHONY: dev build lint typecheck test test-coverage format check

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

test-coverage:
	npx vitest run --coverage

format:
	npx prettier --write .

check: lint typecheck test-coverage build
