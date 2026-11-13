import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {predictSmishing} from '../dist/smishing-model.mjs';

const casesFile = new URL('./robustness_cases.json',import.meta.url);
const modelFile = new URL('../dist/data/smishing-model.json',import.meta.url);
const outputFile = new URL('../dist/data/robustness-results.json',import.meta.url);
const source = JSON.parse(await readFile(casesFile,'utf8'));
const model = JSON.parse(await readFile(modelFile,'utf8'));
const seen = new Set();
const rows=[];
for (const entry of source.cases) {
  if (seen.has(entry.id) || !entry.text || !['smishing','non_smishing','ambiguous'].includes(entry.label)) throw new Error(`Invalid diagnostic case ${entry.id}`);
  seen.add(entry.id);
  const t=performance.now();
  const r=predictSmishing(entry.text,model);
  const milliseconds=performance.now()-t;
  if (!Number.isFinite(r.score) || !['smishing','non_smishing','review'].includes(r.prediction)) throw new Error(`Invalid model result ${entry.id}`);
  rows.push({id:entry.id,category:entry.category,label:entry.label,prediction:r.prediction,
    binaryPrediction:r.binaryPrediction,score:r.score,coverage:r.coverage,
    pairWith:entry.pairWith??null,transformation:entry.transformation??null,milliseconds});
}
function metrics(input) {
  const labelled=input.filter(x=>x.label!=='ambiguous'), decided=labelled.filter(x=>x.prediction!=='review');
  const c={tp:0,fp:0,tn:0,fn:0};
  for (const r of labelled) c[r.binaryPrediction==='smishing'?(r.label==='smishing'?'tp':'fp'):(r.label==='smishing'?'fn':'tn')]++;
  const div=(a,b)=>b?a/b:null;
  const ambiguous=input.filter(x=>x.label==='ambiguous');
  return {count:input.length,labelledCount:labelled.length,ambiguousCount:ambiguous.length,
    rawConfusion:c,rawAccuracy:div(c.tp+c.tn,labelled.length),rawPrecision:div(c.tp,c.tp+c.fp),rawRecall:div(c.tp,c.tp+c.fn),rawF1:div(2*c.tp,2*c.tp+c.fp+c.fn),
    selectedCount:decided.length,reviewCount:input.filter(x=>x.prediction==='review').length,
    labelledCoverage:div(decided.length,labelled.length),selectiveAccuracy:div(decided.filter(x=>x.prediction===x.label).length,decided.length),
    ambiguousReviewRate:div(ambiguous.filter(x=>x.prediction==='review').length,ambiguous.length)};
}
const categories=Object.fromEntries([...new Set(rows.map(r=>r.category))].map(name=>[name,metrics(rows.filter(r=>r.category===name))]));
const pairs=rows.filter(r=>r.pairWith).map(r=>{
  const original=rows.find(base=>base.id===r.pairWith);
  if (!original || original.label!==r.label) throw new Error(`Invalid pair ${r.id}`);
  return {originalId:original.id,modifiedId:r.id,transformation:r.transformation,
    originalScore:original.score,modifiedScore:r.score,absoluteScoreChange:Math.abs(original.score-r.score),
    binaryPredictionChanged:original.binaryPrediction!==r.binaryPrediction,
    reviewDecisionChanged:original.prediction!==r.prediction};
});
const result={suiteVersion:source.version,modelVersion:rows.length?predictSmishing(source.cases[0].text,model).modelVersion:null,
  authored:true,independentTestSet:false,usedForTraining:false,
  protocol:source.provenance,
  limitations:['Fictional intended labels are not independently adjudicated ground truth.','Diagnostic results do not estimate real-world scam accuracy.','Ambiguous examples are excluded from binary correctness metrics.','No model parameters or decision thresholds were changed using this suite.','Timing is a single local Node execution per case, includes initial warmup and is not a browser performance benchmark.'],
  overall:metrics(rows),categories,pairs,
  timing:{runtime:process.version,platform:process.platform,arch:process.arch,meanMilliseconds:rows.reduce((s,r)=>s+r.milliseconds,0)/rows.length},
  cases:rows.map(({milliseconds,...r})=>r)};
await writeFile(outputFile,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({overall:result.overall,categories,pairBinaryFlips:pairs.filter(p=>p.binaryPredictionChanged).length,output:outputFile.pathname},null,2));
