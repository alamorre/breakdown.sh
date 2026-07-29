const unicodeLengthImport = 'const func1 = require("ajv/dist/runtime/ucs2length").default;';
const deepEqualityImport = /const (func\d+) = require\("ajv\/dist\/runtime\/equal"\)\.default;/;

function removeStandaloneValidatorRuntimeImports(source) {
  if (!source.includes(unicodeLengthImport)) {
    throw new Error('The generated validator no longer has the expected Unicode-length helper.');
  }

  const deepEqualityMatch = source.match(deepEqualityImport);
  if (deepEqualityMatch === null) {
    throw new Error('The generated validator no longer has the expected equality helper.');
  }
  const functionName = deepEqualityMatch[1];

  const output = source
    .replace(unicodeLengthImport, 'const func1 = (value) => Array.from(value).length;')
    .replace(
      deepEqualityImport,
      `const ${functionName} = (left, right) => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => ${functionName}(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && ${functionName}(left[key], right[key]));
};`,
    );

  if (output.includes('require(')) {
    throw new Error('The generated validator unexpectedly requires a runtime dependency.');
  }
  return output;
}

const inputChunks = [];
for await (const chunk of process.stdin) inputChunks.push(chunk);
process.stdout.write(
  removeStandaloneValidatorRuntimeImports(Buffer.concat(inputChunks).toString('utf8')),
);
