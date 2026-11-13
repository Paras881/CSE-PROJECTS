/** Versioned snapshot input monitoring and delayed-label error diagnostics.
 * Bounds apply to independent samples for one snapshot, not repeated deployment
 * alerts. Local selective reviews and grouped messages violate those assumptions.
 */
export const MONITOR_MODEL_VERSION = 'smishing-tfidf-v1';
export const MONITOR_VERSION = 'dataguard-2.0.0';
const SPECS = [
  ['length', 'Message length'], ['wordCount', 'Word count'], ['urlCount', 'Links per message']
];
const LABELS = new Set(['smishing', 'non_smishing']);
const PREDICTIONS = new Set([...LABELS, 'review']);
const mean = values => values.reduce((s, x) => s + x, 0) / values.length;
const ratio = (n, d) => d ? n / d : null;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const epoch = x => typeof x === 'string' ? Date.parse(x) : NaN;
const median = xs => { const s = [...xs].sort((a,b) => a-b); return s.length ? (s[Math.floor((s.length-1)/2)] + s[Math.floor(s.length/2)])/2 : null; };

/** Exact two-sample empirical CDF distance; ties processed together. */
export function ksDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length || !a.every(finite) || !b.every(finite)) return null;
  const x = [...a].sort((u,v) => u-v), y = [...b].sort((u,v) => u-v);
  let i=0, j=0, d=0;
  while (i<x.length || j<y.length) {
    const value = Math.min(i<x.length ? x[i] : Infinity, j<y.length ? y[j] : Infinity);
    while (i<x.length && x[i]<=value) i++;
    while (j<y.length && y[j]<=value) j++;
    d = Math.max(d, Math.abs(i/x.length-j/y.length));
  }
  return d;
}

/** Union of two DKW bounds and Bonferroni across k features. */
export function dkwThreshold(n, m, alpha=0.05, k=3) {
  if (!Number.isInteger(n) || !Number.isInteger(m) || n<1 || m<1 || !(alpha>0 && alpha<1) || !Number.isInteger(k) || k<1) return null;
  const log = Math.log(4*k/alpha);
  return Math.sqrt(log/(2*n)) + Math.sqrt(log/(2*m));
}

function validRecord(row) {
  return row && typeof row.id==='string' && row.id.length>0 && row.id.length<=100 &&
    row.modelVersion===MONITOR_MODEL_VERSION && Number.isFinite(epoch(row.timestamp)) &&
    finite(row.score) && row.score>=0 && row.score<=1 && PREDICTIONS.has(row.prediction) &&
    LABELS.has(row.binaryPrediction) && row.binaryPrediction===(row.score>=0.5?'smishing':'non_smishing') &&
    row.features && SPECS.every(([key]) => finite(row.features[key]) && row.features[key]>=0);
}

function confirmed(row) {
  return row.reviewed===true && LABELS.has(row.label) && Number.isFinite(epoch(row.reviewedAt)) && epoch(row.reviewedAt)>=epoch(row.timestamp);
}

function confusion(rows, predictionKey, denominator) {
  if (!rows.length) return null;
  const c = {tp:0, fp:0, tn:0, fn:0};
  for (const r of rows) {
    if (r[predictionKey]==='smishing') c[r.label==='smishing'?'tp':'fp']++;
    else c[r.label==='smishing'?'fn':'tn']++;
  }
  return {...c, precision:ratio(c.tp,c.tp+c.fp), recall:ratio(c.tp,c.tp+c.fn),
    f1:ratio(2*c.tp,2*c.tp+c.fp+c.fn), accuracy:(c.tp+c.tn)/rows.length,
    count:rows.length, coverage:ratio(rows.length,denominator)};
}

function referenceValid(reference) {
  return reference && reference.modelVersion===MONITOR_MODEL_VERSION && typeof reference.id==='string' &&
    reference.features && SPECS.every(([key]) => Array.isArray(reference.features[key]) &&
      reference.features[key].length>=30 && reference.features[key].every(x => finite(x) && x>=0)) &&
    new Set(SPECS.map(([key]) => reference.features[key].length)).size===1;
}

function errorDiagnostic(reviewed, reference) {
  const ordered = [...reviewed].sort((a,b) => epoch(a.reviewedAt)-epoch(b.reviewedAt) || epoch(a.timestamp)-epoch(b.timestamp) || a.id.localeCompare(b.id));
  const delays = ordered.map(r => (epoch(r.reviewedAt)-epoch(r.timestamp))/3600000);
  const base = {status:'insufficient', message:'Collect 50 confirmed outcomes to inspect delayed-label error changes. Unknown labels are excluded.',method:'hoeffding-snapshot',
    reviewedCount:ordered.length, baselineError:null, currentError:null, ewma:null, threshold:null,
    lastReviewedAt:ordered.at(-1)?.reviewedAt??null, labelDelayMedianHours:median(delays), lambda:0.1, warmup:50,alpha:0.05};
  if (!referenceValid(reference) || !finite(reference.errorRate) || reference.errorRate<0 || reference.errorRate>1 || !Number.isInteger(reference.errorRateRows) || reference.errorRateRows<30) {
    return {...base, status:'unavailable', message:'A matching calibration error reference is unavailable. Confirmed confusion counts remain available.'};
  }
  // Small floor avoids a zero-variance boundary when calibration sees no errors.
  const p = Math.max(0.02, Math.min(0.98,reference.errorRate));
  const ewmaThreshold = Math.min(1, p+3*Math.sqrt(p*(1-p)*0.1/(2-0.1)));
  let ewma=p;
  for (const r of ordered) ewma=0.1*Number(r.binaryPrediction!==r.label)+0.9*ewma;
  const currentCount = Math.min(50,ordered.length);
  const currentError = ordered.length ? mean(ordered.slice(-50).map(r => Number(r.binaryPrediction!==r.label))) : null;
  // One-sided Hoeffding tails for reference-underestimation and current-overestimation.
  // Calibration fitting and selective reviews invalidate deployment guarantees;
  // this conservative snapshot diagnostic is intentionally not a lifetime alarm.
  const margin=currentCount?Math.sqrt(Math.log(2/0.05)/(2*reference.errorRateRows))+Math.sqrt(Math.log(2/0.05)/(2*currentCount)):null;
  const threshold=margin===null?null:Math.min(1,reference.errorRate+margin);
  const detail = {...base,baselineError:reference.errorRate,referenceCount:reference.errorRateRows,currentCount,referenceFloor:p,currentError,ewma:ordered.length?ewma:null,ewmaThreshold,threshold,margin};
  if (ordered.length<50) return detail;
  const shifted=currentError>threshold;
  return {...detail,status:shifted?'shift':'stable',message:shifted?
    'Recent confirmed errors exceeded the conservative snapshot limit. Investigate the reviewed cases; selective reviews, calibration reuse and label delays can affect this diagnostic.':
    'Recent confirmed errors did not exceed the conservative snapshot limit. This does not establish stable accuracy on unreviewed messages. EWMA is diagnostic only.'};
}

/** Never combines model versions or turns missing reviews into correct outcomes. */
export function monitorResearchRecords(records, reference, options={}) {
  const input=Array.isArray(records)?records:[];
  // Deduplicate stable IDs: the last valid copy is the current reviewed state.
  const byId=new Map();
  for (const row of input) if (validRecord(row)) byId.set(row.id,row);
  const rows=[...byId.values()].sort((a,b)=>epoch(a.timestamp)-epoch(b.timestamp)||a.id.localeCompare(b.id));
  const reviewed=rows.filter(confirmed), selected=reviewed.filter(r=>r.prediction!=='review');
  const opts=options && typeof options==='object'?options:{};
  const minCurrent=Number.isInteger(opts.minCurrent)&&opts.minCurrent>=30?opts.minCurrent:30;
  const windowSize=Number.isInteger(opts.windowSize)&&opts.windowSize>=minCurrent?opts.windowSize:Math.max(50,minCurrent);
  const alpha=finite(opts.alpha)&&opts.alpha>0&&opts.alpha<1?opts.alpha:0.05;
  const current=rows.slice(-windowSize);
  let drift={status:'insufficient',message:`Collect ${minCurrent} model checks to compare input distributions with the frozen training reference.`,
    referenceId:reference?.id??null,baselineCount:0,currentCount:current.length,threshold:null,alpha,features:[]};
  if (!referenceValid(reference)) {
    drift={...drift,status:'unavailable',message:'A valid reference for this model version is unavailable. Input comparison is paused.'};
  } else {
    drift.baselineCount=reference.features.length.length;
    if (current.length>=minCurrent) {
      const threshold=dkwThreshold(drift.baselineCount,current.length,alpha,SPECS.length);
      const features=SPECS.map(([key,name])=>{
        const ref=reference.features[key], now=current.map(r=>r.features[key]);
        const statistic=ksDistance(ref,now), baseline=mean(ref), value=mean(now);
        return {key,name,baseline,current:value,delta:value-baseline,statistic,threshold,shifted:statistic>threshold};
      });
      const shifted=features.some(f=>f.shifted);
      drift={...drift,threshold,features,status:shifted?'shift':'stable',message:shifted?
        'At least one input distribution exceeded the conservative snapshot bound. This is an input-change signal, not proof of model deterioration.':
        'No input distribution exceeded the conservative snapshot bound. Small or unmeasured changes may still be present.'};
    }
  }
  return {version:MONITOR_VERSION,modelVersion:MONITOR_MODEL_VERSION,count:rows.length,excludedCount:input.length-rows.length,
    reviewedCount:reviewed.length,reviewCoverage:ratio(reviewed.length,rows.length),abstainedCount:rows.filter(r=>r.prediction==='review').length,
    performance:confusion(selected,'prediction',reviewed.length),binaryPerformance:confusion(reviewed,'binaryPrediction',reviewed.length),
    drift,errorMonitor:errorDiagnostic(reviewed,reference)};
}
