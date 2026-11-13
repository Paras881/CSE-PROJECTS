import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {predictSpam} from '../dist/ml-model.mjs';

const model = JSON.parse(await readFile(new URL('../dist/data/spam-model.json', import.meta.url), 'utf8'));
const fixtures = JSON.parse(await readFile(new URL('../dist/data/inference-fixtures.json', import.meta.url), 'utf8'));
for (const expected of fixtures) {
  const actual = predictSpam(expected.text, model);
  assert.ok(Math.abs(actual.score - expected.score) < 1e-12, `score differs: ${expected.text}`);
  assert.equal(actual.knownTokenCount, expected.knownTokenCount);
  assert.equal(actual.totalTokenCount, expected.totalTokenCount);
  assert.equal(actual.topTokens.length, expected.topTokens.length);
  for (let index = 0; index < actual.topTokens.length; index++) {
    assert.equal(actual.topTokens[index].token, expected.topTokens[index].token);
    assert.ok(Math.abs(actual.topTokens[index].weight - expected.topTokens[index].weight) < 1e-10);
  }
}
assert.throws(() => predictSpam('message', null), /Unsupported/);
assert.equal(predictSpam('constructor __proto__ toString', {schemaVersion:1,task:'spam-vs-ham',logPrior:[0,0],vocabulary:{}}).knownTokenCount, 0);
console.log(`Inference parity passed for ${fixtures.length} Python/JavaScript fixtures, plus invalid-model and prototype-key checks.`);
