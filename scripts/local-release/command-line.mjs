export function requiredArgumentValue(argv, name, usage) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.length === 0) {
    throw new Error(usage);
  }
  return value;
}
