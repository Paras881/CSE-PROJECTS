import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeMessage,toRecord,cleanRecord,makeDemoRecords,ENGINE_VERSION,SIGNALS_VERSION,MAX_MESSAGE_LENGTH} from '../dist/engine.mjs';
import {predictSpam} from '../dist/ml-model.mjs';
import {predictSmishing,validateSmishingModel} from '../dist/smishing-model.mjs';

const model=JSON.parse(await readFile(new URL('../dist/data/smishing-model.json',import.meta.url),'utf8'));
function record(overrides={}){
  return {...toRecord(analyzeMessage('Meet me at the library after class.',model)),...overrides};
}
test('empty non-string and excessively long inputs are rejected',()=>{
  for(const value of ['', '  \n\t',null,undefined,32])assert.throws(()=>analyzeMessage(value),/Paste a message/);
  assert.throws(()=>analyzeMessage('x'.repeat(MAX_MESSAGE_LENGTH+1)),/12,000/);
  assert.doesNotThrow(()=>analyzeMessage('x'.repeat(MAX_MESSAGE_LENGTH)));
});
test('credential and threat rules show matched evidence independently of the model',()=>{
  const a=analyzeMessage('Your account will be suspended. Share your OTP immediately.');
  assert.equal(a.riskBand,'High concern');
  assert.equal(a.prediction,'review');
  assert.equal(a.binaryPrediction,null);
  assert.equal(a.modelVersion,SIGNALS_VERSION);
  assert.ok(a.evidence.some(e=>e.id==='credential'&&e.snippet.includes('OTP')));
  assert.ok(a.evidence.some(e=>e.id==='threat'));
  assert.ok(a.riskScore>=55&&a.riskScore<=100);
});
test('ordinary messages produce no safety verdict',()=>{
  const a=analyzeMessage('See you at the library after class.');
  assert.equal(a.riskScore,0);assert.equal(a.evidence.length,0);
  assert.ok(!/safe|verified|guaranteed/i.test(a.riskBand));
  assert.equal(a.smishing,null);assert.equal(a.prediction,'review');
});
test('payment signals match complete words not feedback substrings',()=>{
  for(const text of ['Your internship interview feedback is available.','Please send feedback on my job application.']){
    const a=analyzeMessage(text);assert.equal(a.evidence.some(e=>e.id==='advance-fee'),false);assert.equal(a.riskScore,0);
  }
});
test('shortened links and urgency alone never produce high heuristic concern',()=>{
  const a=analyzeMessage('Urgent meeting update at https://bit.ly/example');
  assert.ok(a.evidence.some(e=>e.id==='short-link'));assert.notEqual(a.riskBand,'High concern');assert.ok(a.riskScore<55);
});
test('invisible formatting is normalized for credential rule inspection',()=>{
  const a=analyzeMessage('Share your pass\u200bword immediately.');
  assert.ok(a.evidence.some(e=>e.id==='credential'));
});
test('model assessment and abstention come from the trained model independently of rules',()=>{
  assert.equal(validateSmishingModel(model),true);
  for(const text of ['Your account is suspended. Send your password immediately.','Meet me in the library after class.','xyzzpq zzqqxx vvqqzz']){
    const expected=predictSmishing(text,model),actual=analyzeMessage(text,model);
    assert.deepEqual(actual.smishing,expected);assert.equal(actual.prediction,expected.prediction);
    assert.equal(actual.modelVersion,ENGINE_VERSION);assert.equal(actual.score,expected.score);
  }
  assert.equal(analyzeMessage('xyzzpq zzqqxx vvqqzz',model).prediction,'review');
});
test('stored record whitelist removes raw text excerpts learned features and arbitrary injected fields',()=>{
  const marker='secret-account-unique-id';
  const a=analyzeMessage(`My ${marker}: Please send your password immediately`,model);
  a.text=marker;a.evidence.push({snippet:marker});a.features.injected=marker;
  a.smishing.topFeatures.push({feature:marker,weight:99});
  const row=toRecord(a);
  assert.equal(row.label,null);assert.equal(row.reviewed,false);assert.equal(row.reviewedAt,null);
  assert.ok(!('evidence' in row)&&!('text' in row)&&!('smishing' in row));
  assert.ok(!JSON.stringify(row).includes(marker));
  assert.deepEqual(Object.keys(row.features).sort(),['length','wordCount','urlCount','urgency','payment','credential','nonAsciiRatio'].sort());
  assert.notEqual(row.features,a.features);
});
test('history rejects stale versions corrupt probabilities and invalid feature ranges',()=>{
  const r=record();
  for(const bad of [null,{}, {...r,modelVersion:'signals-0.1.0'},{...r,modelVersion:'other-model'},{...r,score:NaN},{...r,score:2},{...r,coverage:-0.1},{...r,binaryPrediction:r.binaryPrediction==='smishing'?'non_smishing':'smishing'},{...r,timestamp:'invalid'},{...r,id:'x'.repeat(101)},{...r,features:{...r.features,length:Infinity}},{...r,features:{...r.features,wordCount:2.5}},{...r,features:{...r.features,urgency:7}},{...r,features:{...r.features,nonAsciiRatio:2}}])assert.equal(cleanRecord(bad),null);
});
test('proposed labels and invalid review arrival times never become confirmed reviews',()=>{
  const r=record({timestamp:'2026-01-01T12:00:00Z',label:'smishing',reviewed:true});
  for(const reviewedAt of [null,undefined,'invalid','2026-01-01T11:00:00Z']){
    const clean=cleanRecord({...r,reviewedAt});assert.equal(clean.reviewed,false);assert.equal(clean.reviewedAt,null);
  }
  const reviewed=cleanRecord({...r,reviewedAt:'2026-01-01T13:00:00Z'});
  assert.equal(reviewed.reviewed,true);assert.equal(reviewed.label,'smishing');
  const proposed=cleanRecord({...r,reviewed:false,reviewedAt:'2026-01-01T13:00:00Z'});
  assert.equal(proposed.reviewed,false);assert.equal(proposed.reviewedAt,null);
});
test('synthetic records cannot enter the session storage whitelist',()=>{
  const r={...record(),synthetic:true};
  assert.equal(cleanRecord(r),null);assert.equal(cleanRecord(r,{allowSynthetic:true}).synthetic,true);
});
test('rules-only checks cannot claim learned scores or reviewed model performance',()=>{
  const r=toRecord(analyzeMessage('Please send your OTP immediately.'));
  const cleaned=cleanRecord({...r,label:'smishing',reviewed:true,reviewedAt:new Date().toISOString(),score:1,binaryPrediction:'smishing'});
  assert.equal(cleaned.score,null);assert.equal(cleaned.prediction,'review');assert.equal(cleaned.binaryPrediction,null);assert.equal(cleaned.label,null);assert.equal(cleaned.reviewed,false);
});
test('synthetic demo uses genuine model inference with explicit authored labels',()=>{
  assert.deepEqual(makeDemoRecords(),[]);
  const rows=makeDemoRecords(model);
  assert.equal(rows.length,60);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
  assert.ok(rows.every(r=>r.synthetic===true&&r.reviewed===true&&r.id.startsWith('demo-')&&r.modelVersion===ENGINE_VERSION&&Date.parse(r.reviewedAt)>=Date.parse(r.timestamp)));
  assert.ok(rows.every(r=>!('text'in r)&&!('evidence'in r)&&!('topFeatures'in r)));
});
test('historical spam inference still matches independent exported Python fixtures',async()=>{
  const archive=JSON.parse(await readFile(new URL('../dist/data/spam-model.json',import.meta.url),'utf8'));
  const fixtures=JSON.parse(await readFile(new URL('../dist/data/inference-fixtures.json',import.meta.url),'utf8'));
  for(const f of fixtures){const r=predictSpam(f.text,archive);assert.ok(Math.abs(r.score-f.score)<1e-10);assert.equal(r.knownTokenCount,f.knownTokenCount);assert.equal(r.totalTokenCount,f.totalTokenCount);assert.deepEqual(r.topTokens.map(t=>t.token),f.topTokens.map(t=>t.token));}
});
