import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {predictSmishing,preprocessSmishing,validateSmishingModel} from '../dist/smishing-model.mjs';
const model=JSON.parse(await readFile(new URL('../dist/data/smishing-model.json',import.meta.url),'utf8'));
const fixtures=JSON.parse(await readFile(new URL('../dist/data/smishing-fixtures.json',import.meta.url),'utf8')).fixtures;

test('all authored Python predictions match browser arithmetic and review decisions',()=>{
  for(const f of fixtures){
    const r=predictSmishing(f.text,model);
    assert.ok(Math.abs(r.score-f.score)<1e-12,f.text);
    assert.ok(Math.abs(r.rawScore-f.rawScore)<1e-12,f.text);
    assert.equal(r.prediction,f.prediction);assert.equal(r.coverage,f.coverage);
    assert.equal(r.totalTokenCount,f.totalTokenCount);
    assert.equal(r.binaryPrediction,r.score>=.5?'smishing':'non_smishing');
  }
});
test('malformed or unsupported model artifacts fail before inference',()=>{
  const invalid=[null,{}, {...model,version:'wrong'}, {...model,intercept:NaN}, {...model,word:{...model.word,idf:[1]}}, {...model,char:{...model.char,coefficients:[]}}, {...model,abstain:{...model.abstain,low:.6}}];
  for(const bad of invalid){assert.equal(validateSmishingModel(bad),false);assert.throws(()=>predictSmishing('Check this message please',bad));}
});
test('unknown tokens and short inputs defer instead of displaying class prior as a decision',()=>{
  const unknown=predictSmishing('qxzv plmok zzyx',model);
  assert.equal(unknown.prediction,'review');assert.equal(unknown.coverage,0);
  assert.equal(predictSmishing('hello',model).prediction,'review');
  assert.equal(predictSmishing('🍀',model).prediction,'review');
});
test('identifier masking and invisible formatting are stable without opening links',()=>{
  assert.equal(preprocessSmishing('PAY 123 at https://a.example/x'),preprocessSmishing('pay 456 at https://b.example/y'));
  assert.equal(preprocessSmishing('pass\u200bword'),preprocessSmishing('password'));
  assert.equal(preprocessSmishing('ＦＲＥＥ １２３'),preprocessSmishing('free 123'));
  assert.equal(predictSmishing('Send code to a@example.test now',model).score,predictSmishing('Send code to b@example.test now',model).score);
});
test('every statically declared application data request has a packaged artifact',async()=>{
  const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const paths=[...app.matchAll(/'\.\/data\/([^']+\.json)'/g)].map(m=>m[1]);
  assert.ok(paths.length>=6);
  for(const path of paths)await access(new URL('../dist/data/'+path,import.meta.url));
});
