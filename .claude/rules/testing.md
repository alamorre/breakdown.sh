# Testing Rules

## Runner

- Vitest for all tests
- Run with `make test` (alias for `npx vitest run`)

## File Location

- Co-located: `foo.ts` → `foo.test.ts` in the same directory
- Test files follow the same naming convention as source files

## Coverage

- 80% line coverage minimum, enforced in CI
- Run coverage with `npx vitest run --coverage`

## Test Structure

- `describe("functionName")` → `it("should do specific thing")`
- One logical assertion per `it` block when possible
- Group related tests under the same `describe`

## Assertions

- Assert specific values — no `expect(true)` or `expect(x).toBeDefined()`
- Use `toEqual` for objects, `toBe` for primitives
- Use `toThrow` for error cases

## Mocking

- Mock only external boundaries: Supabase client, Claude API, fetch
- Never mock the module under test
- Use `vi.mock()` for module mocks, `vi.fn()` for function mocks
- Reset mocks in `beforeEach` or `afterEach`

## Integration Tests

- Server actions: test the full action, mock only the DB/API client
- Canvas interactions: test store actions, not React Flow internals
