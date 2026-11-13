import test from 'node:test';
import assert from 'node:assert/strict';
import {ksDistance,dkwThreshold,monitorResearchRecords,MONITOR_MODEL_VERSION} from '../dist/monitoring.mjs';
const start=Date.UTC(2026,0,1);
function row(i,extra={}) {
  return {id:`row-${i}`,timestamp:new Date(start+i*3600000).toISOString(),modelVersion:MONITOR_MODEL_VERSION,
    score:0.1,prediction:'non_smishing',binaryPrediction:'non_smishing',features:{length:100,wordCount:20,urlCount:0},
    reviewed:false,label:null,reviewedAt:null,...extra};
}
function reference(extra={}) {
  return {id:'test-training',modelVersion:MONITOR_MODEL_VERSION,features:{length:Array(600).fill(100),wordCount:Array(600).fill(20),urlCount:Array(600).fill(0)},errorRate:0.1,errorRateRows:200,...extra};
}
function reviewed(i, extra={}) { return row(i,{label:'non_smishing',reviewed:true,reviewedAt:new Date(start+(i+1)*3600000).toISOString(),...extra}); }

test('empirical CDF distance processes ties exactly and rejects invalid arrays',()=>{
  assert.equal(ksDistance([1,1,2,3],[1,2,2,3]),0.25);
  assert.equal(ksDistance([0,0],[1,1]),1);
  assert.equal(ksDistance([3,1,2],[2,3,1]),0);
  assert.equal(ksDistance([],[]),null);
  assert.equal(ksDistance([1,NaN],[1]),null);
});
test('snapshot bound shrinks with larger samples and expands for multiplicity',()=>{
  assert.ok(dkwThreshold(600,50)<dkwThreshold(600,30));
  assert.ok(dkwThreshold(600,50,0.05,3)>dkwThreshold(600,50,0.05,1));
  assert.equal(dkwThreshold(0,30),null);
  assert.equal(dkwThreshold(20,30,2),null);
});
test('monitor uses a frozen versioned reference and waits for 30 samples',()=>{
  const r=reference();
  const small=monitorResearchRecords(Array.from({length:29},(_,i)=>row(i)),r);
  assert.equal(small.drift.status,'insufficient');
  const stable=monitorResearchRecords(Array.from({length:50},(_,i)=>row(i)),r);
  assert.equal(stable.drift.status,'stable');
  assert.equal(stable.drift.baselineCount,600);
  assert.equal(stable.drift.currentCount,50);
  assert.equal(stable.reviewedCount,0);
  assert.equal(stable.performance,null);
  const shifted=monitorResearchRecords(Array.from({length:50},(_,i)=>row(i,{features:{length:1000,wordCount:200,urlCount:2}})),r);
  assert.equal(shifted.drift.status,'shift');
  assert.equal(shifted.drift.features[0].statistic,1);
});
test('invalid and duplicate records do not contaminate reference or counts',()=>{
  const rows=[row(0),row(0),row(1,{modelVersion:'old'}),row(2,{score:Infinity}),row(3,{features:{length:-2,wordCount:1,urlCount:0}}),row(4,{binaryPrediction:'smishing'}),null];
  const m=monitorResearchRecords(rows,reference());
  assert.equal(m.count,1);assert.equal(m.excludedCount,6);
  assert.equal(monitorResearchRecords(null,null).drift.status,'unavailable');
  assert.equal(monitorResearchRecords([row(1)],reference({modelVersion:'old'})).count,1);
  assert.equal(monitorResearchRecords([row(1)],reference({modelVersion:'old'})).drift.status,'unavailable');
});
test('only explicitly reviewed valid labels enter metrics and abstentions remain separate',()=>{
  const rows=[reviewed(0),reviewed(1,{score:0.9,prediction:'smishing',binaryPrediction:'smishing',label:'smishing'}),
    reviewed(2,{score:0.6,prediction:'review',binaryPrediction:'smishing',label:'non_smishing'}),
    reviewed(3,{reviewed:false}),reviewed(4,{reviewedAt:null}),reviewed(5,{reviewedAt:new Date(start).toISOString()})];
  const m=monitorResearchRecords(rows,reference());
  assert.equal(m.reviewedCount,3);assert.equal(m.reviewCoverage,0.5);
  assert.deepEqual([m.performance.tp,m.performance.tn,m.performance.fp,m.performance.fn],[1,1,0,0]);
  assert.equal(m.performance.coverage,2/3);assert.equal(m.binaryPerformance.fp,1);
  assert.equal(m.abstainedCount,1);
});
test('error diagnostic processes labels by review arrival and exposes label delay',()=>{
  const rows=Array.from({length:60},(_,i)=>reviewed(i,{label:i<10?'smishing':'non_smishing',reviewedAt:new Date(start+(120-i)*3600000).toISOString()}));
  const m=monitorResearchRecords(rows.reverse(),reference());
  assert.equal(m.errorMonitor.status,'stable');
  assert.ok(m.errorMonitor.ewma>m.errorMonitor.ewmaThreshold);
  assert.ok(m.errorMonitor.currentError<m.errorMonitor.threshold);
  assert.equal(m.errorMonitor.reviewedCount,60);
  assert.equal(m.errorMonitor.lastReviewedAt,new Date(start+120*3600000).toISOString());
  assert.equal(m.errorMonitor.labelDelayMedianHours,61);
  assert.equal(m.errorMonitor.currentError,0.2);
});
test('old versions and missing calibration reference cannot trigger error alerts',()=>{
  const rows=Array.from({length:60},(_,i)=>reviewed(i,{label:'smishing'}));
  assert.equal(monitorResearchRecords(rows,reference({errorRate:null})).errorMonitor.status,'unavailable');
  const wrong=rows.map(r=>({...r,modelVersion:'old'}));
  assert.equal(monitorResearchRecords(wrong,reference()).errorMonitor.status,'insufficient');
  assert.equal(monitorResearchRecords(rows.slice(0,49),reference()).errorMonitor.status,'insufficient');
});
test('default error signal requires finite reference uncertainty and a large observed change',()=>{
  const rows=Array.from({length:60},(_,i)=>reviewed(i,{label:'smishing'}));
  const m=monitorResearchRecords(rows,reference());
  assert.equal(m.errorMonitor.status,'shift');
  assert.equal(m.errorMonitor.method,'hoeffding-snapshot');
  assert.ok(m.errorMonitor.threshold>0.35);
  assert.equal(monitorResearchRecords(rows,reference({errorRateRows:undefined})).errorMonitor.status,'unavailable');
});
