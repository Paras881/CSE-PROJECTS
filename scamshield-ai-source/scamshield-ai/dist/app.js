import {analyzeMessage, toRecord, cleanRecord, makeDemoRecords, ENGINE_VERSION, SIGNALS_VERSION} from './engine.mjs';
import {validateSmishingModel} from './smishing-model.mjs';
import {monitorResearchRecords} from './monitoring.mjs';

const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const percent=n=>Number.isFinite(n)?(n*100).toFixed(1)+'%':'—';
const decimal=(n,digits=2)=>Number.isFinite(n)?n.toFixed(digits):'—';
const STORAGE_KEY='scamshield-records-v2';
const predictionNames={smishing:'Smishing likely',non_smishing:'Few learned smishing signals',review:'Human review needed'};
const examples={
  internship:'Congratulations on your internship offer! Pay a registration fee of Rs 2500 immediately to confirm your seat.',
  phishing:'Your account will be suspended. Share your OTP immediately at https://bit.ly/example to keep access.',
  normal:'Hi! Our project review is on Tuesday at 10 am. Please bring your notes and meet me outside the lab.'
};
let model=null, reference=null, metrics=null, baseline=null, monitoringExperiment=null, robustness=null, exportUrl=null;
let activeView='analyzer', demoMode=false, latest=null, loading=false;
let demoRecords=[], sessionRecords=[], hasLegacyHistory=false;
try {
  hasLegacyHistory=localStorage.getItem('scamshield-records-v1')!==null;
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
  sessionRecords=Array.isArray(saved)?saved.map(row=>cleanRecord(row)).filter(Boolean).slice(-500):[];
} catch { sessionRecords=[]; }
function notice(message){$('notice').textContent=message;$('notice').hidden=false;}
function persist(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(sessionRecords.map(row=>cleanRecord(row)).filter(Boolean)));return true;}
  catch{notice('Browser storage is unavailable or full. Checks still work, but history may not survive a reload.');return false;}
}
function records(){return demoMode?demoRecords:sessionRecords;}
function metric(label,value,caption=''){return `<div class="metric"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(caption)}</small></div>`;}
function switchView(view){
  if(!['analyzer','monitoring','lab'].includes(view))view='analyzer';
  activeView=view;
  document.querySelectorAll('.view').forEach(section=>section.hidden=section.id!==`view-${view}`);
  document.querySelectorAll('[data-view]').forEach(button=>{const selected=button.dataset.view===view;button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');});
  $('breadcrumb').textContent={analyzer:'Message analyzer',monitoring:'DataGuard monitor',lab:'Model lab'}[view];
  if(view==='monitoring')renderMonitoring();
  if(view==='analyzer'&&latest)renderResult(latest);
  if(view==='lab')renderLab();
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{location.hash=button.dataset.view;switchView(button.dataset.view);}));
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('message').value=examples[button.dataset.example];$('char-count').textContent=$('message').value.length;$('message').focus();}));
$('message').addEventListener('input',()=>{$('char-count').textContent=$('message').value.length;});

function reviewControls(row,context='result'){
  if(row.modelVersion!==ENGINE_VERSION)return '<p class="microcopy">This was a rules-only check. Load the model and analyze again to create a model prediction for review.</p>';
  return `<div class="review-form" data-record="${escape(row.id)}"><label for="label-${context}-${escape(row.id)}">Proposed label</label><select id="label-${context}-${escape(row.id)}" data-label="${escape(row.id)}"><option value="" ${row.label?'':'selected'}>Not labelled</option><option value="smishing" ${row.label==='smishing'?'selected':''}>Smishing</option><option value="non_smishing" ${row.label==='non_smishing'?'selected':''}>Non-smishing (includes spam)</option></select><button class="secondary" data-confirm="${escape(row.id)}" ${!row.label||row.reviewed?'disabled':''}>${row.reviewed?'Reviewed':'Confirm reviewed label'}</button><small>${row.reviewed?(row.prediction==='review'?'Included in binary review metrics; excluded from accepted-decision metrics.':'Included in reviewed metrics.'):'A proposed label alone is excluded from metrics.'}</small></div>`;
}
function renderResult(result){
  const row=sessionRecords.find(r=>r.id===result.id), learned=result.smishing;
  const tone=!learned||learned.prediction==='review'?'medium':learned.prediction==='smishing'?'high':'low';
  const evidence=result.evidence.length?result.evidence.map(item=>`<article class="evidence-item"><h3>${escape(item.title)} <span>+${item.weight}</span></h3><p>${escape(item.detail)}</p><div class="snippet">“${escape(item.snippet)}”</div></article>`).join(''):'<p class="empty-note">No configured warning patterns matched. Subtle wording and new scams may still be missed.</p>';
  $('result').innerHTML=`<div class="card-top"><h2>Your assessment</h2><span class="tag risk-${tone}">${learned?escape(predictionNames[learned.prediction]):'RULES ONLY'}</span></div>
    ${learned?`<div class="score-row"><div class="score-number risk-${tone}">${percent(learned.score)}</div><div><strong>Calibrated smishing score</strong><p>English SMS research model</p></div></div><p><strong>${escape(learned.reason)}</strong></p><p class="microcopy">${learned.prediction==='review'?'The model abstained. Its score is diagnostic, not a decision. ':''}Calibration was measured on one research dataset. This is not a verified real-world probability. A low score does not establish safety; non-smishing includes unsolicited advertising.</p><div class="model-explanation"><h3>What influenced the model</h3><p class="microcopy">${learned.knownTokenCount} of ${learned.totalTokenCount} word tokens recognized (${percent(learned.coverage)} coverage). Word and character fragments may contain masked placeholders. Their signed arithmetic contributions describe the text model before calibration, not proof of a sender’s intent.</p><div class="token-list">${learned.topFeatures.slice(0,8).map(item=>`<span class="token">${escape(item.feature)} ${item.weight>=0?'+':''}${decimal(item.weight,3)}</span>`).join('')||'<span class="microcopy">No learned features matched.</span>'}</div></div>`:'<p><strong>The smishing model is unavailable.</strong> The warning rules below still work. Use “Retry loading” to restore the model.</p>'}
    ${learned?.prediction==='non_smishing'&&result.riskScore>=55?'<p class="notice"><strong>The signals disagree.</strong> Warning rules found reasons to investigate despite the low learned score. Check the evidence and verify the request independently.</p>':''}<details class="signal-details" ${!learned||result.riskScore>=55?'open':''}><summary>Warning rules · ${result.riskScore}/100 concern index</summary><p class="microcopy">A separate heuristic index, not a probability or the model prediction. Rules and the learned model may disagree; inspect both. Rules may misread quotes, negation, and legitimate requests.</p><div class="evidence">${evidence}</div></details>
    <div class="result-review"><h3>Review this result</h3><p class="microcopy">Smishing means a deceptive SMS intended to steal money, credentials, or access. Confirm labels using the original message and supporting evidence. Your review is not independent verification.</p>${row?reviewControls(row):''}</div>`;
}
$('analyze').addEventListener('click',()=>{
  try{
    latest=analyzeMessage($('message').value,model);
    const row=toRecord(latest);
    if(!row)throw new Error('This result could not be recorded. Please reload the model and try again.');
    sessionRecords.push(row);sessionRecords=sessionRecords.slice(-500);
    $('notice').hidden=true;persist();renderResult(latest);
  }catch(error){notice(error.message||'The check could not be completed. Please try again.');$('message').focus();}
});
function confusionCards(p){
  return `<div class="metric-grid two">${metric('True positives',p.tp,'Smishing correctly flagged')}${metric('False positives',p.fp,'Non-smishing flagged')}${metric('True negatives',p.tn,'Non-smishing unflagged')}${metric('False negatives',p.fn,'Smishing missed')}</div><p><strong>F1 ${percent(p.f1)}</strong> · Accuracy ${percent(p.accuracy)} · ${p.count} reviewed predictions</p>`;
}
function renderMonitoring(){
  const list=records(), summary=monitorResearchRecords(list,reference), p=summary.performance;
  $('session-mode').classList.toggle('active',!demoMode);$('session-mode').setAttribute('aria-pressed',String(!demoMode));
  $('demo-mode').classList.toggle('active',demoMode);$('demo-mode').setAttribute('aria-pressed',String(demoMode));
  $('demo-banner').hidden=!demoMode;$('clear').disabled=demoMode||(!sessionRecords.length&&!hasLegacyHistory);
  const featureBars=summary.drift.features.map(feature=>{
    const max=Math.max(feature.baseline,feature.current,0.01);
    return `<div class="bar-row"><div><strong>${escape(feature.name)}</strong><span class="status-chip ${feature.shifted?'risk-medium':''}">${feature.shifted?'Changed':'Within threshold'}</span></div><div class="bar-track"><i class="bar baseline" style="width:${feature.baseline/max*100}%"></i></div><div class="bar-track"><i class="bar current" style="width:${feature.current/max*100}%"></i></div><small>Mean reference ${decimal(feature.baseline)} · Current ${decimal(feature.current)}<br>Distribution distance ${decimal(feature.statistic,3)} · Threshold ${decimal(feature.threshold,3)}</small></div>`;
  }).join('');
  $('monitoring-content').innerHTML=`<div class="metric-grid">${metric('Model checks retained',summary.count,demoMode?'Authored synthetic examples':'Current model, latest 500')}${metric('Reviewed outcomes',summary.reviewedCount,`${percent(summary.reviewCoverage)} labelled coverage`)}${metric('Precision',percent(p?.precision),'Accepted decisions, reviewed only')}${metric('Recall',percent(p?.recall),'Accepted decisions, reviewed only')}</div>
  <div class="monitor-grid"><article class="card"><div class="card-top"><h2>Input distribution changes</h2><span class="tag ${summary.drift.status==='shift'?'risk-medium':'neutral'}">${{insufficient:'GATHERING DATA',stable:'NO FLAG',shift:'INVESTIGATE',unavailable:'UNAVAILABLE'}[summary.drift.status]}</span></div><p>${escape(summary.drift.message)}</p><div class="chart-bars">${featureBars||`<div class="empty-state small"><strong>${Math.min(summary.count,30)} / 30 checks</strong><p>A frozen training reference is compared with up to 50 recent checks.</p></div>`}</div><p class="microcopy">Reference: ${escape(summary.drift.referenceId??'not loaded')} · ${summary.drift.baselineCount} reference rows · ${summary.drift.currentCount} current rows. Bars show means; flags compare whole distributions. The conservative bound applies to one comparison under sampling assumptions. Repeated checks and related messages weaken that interpretation. An input alert does not prove accuracy has fallen.</p></article>
  <article class="card"><div class="card-top"><h2>Reviewed prediction quality</h2><span class="tag neutral">${summary.abstainedCount} ABSTAINED</span></div><p>Accepted decisions use the model’s abstention policy. Human-review predictions are excluded from this confusion matrix.</p>${p?confusionCards(p):'<div class="empty-state small"><strong>No accepted and reviewed outcomes yet.</strong><p>Confirm labels using message context. Unknown performance is never shown as 0%.</p></div>'}<p class="microcopy">${p?`Accepted coverage among reviewed rows: ${percent(p.coverage)}. `:''}Convenience labels may be selectively reviewed and inaccurate. They are not an independent benchmark.</p>${summary.binaryPerformance?`<details><summary>All reviewed predictions at the 0.5 threshold</summary><p class="microcopy">Includes messages that the app asked a human to review. This measures the underlying binary classifier, not autonomous decisions.</p>${confusionCards(summary.binaryPerformance)}</details>`:''}</article></div>
  <article class="card lab-metrics"><div class="card-top"><h2>Delayed outcome monitoring</h2><span class="tag ${summary.errorMonitor.status==='shift'?'risk-medium':'neutral'}">${{insufficient:'GATHERING REVIEWS',stable:'NO FLAG',shift:'INVESTIGATE',unavailable:'UNAVAILABLE'}[summary.errorMonitor.status]}</span></div><p>${escape(summary.errorMonitor.message)}</p><div class="metric-grid">${metric('Reference error',percent(summary.errorMonitor.baselineError),'Calibration split; also used to fit score mapping')}${metric('Reviewed error',percent(summary.errorMonitor.currentError),'Underlying binary predictions')}${metric('Warning threshold',percent(summary.errorMonitor.threshold),'Conservative error comparison')}${metric('Median review delay',Number.isFinite(summary.errorMonitor.labelDelayMedianHours)?decimal(summary.errorMonitor.labelDelayMedianHours,1)+' h':'—','From prediction to confirmation')}</div><p class="microcopy">Unreviewed outcomes remain unknown. An alert is an investigation prompt, not proof of concept drift. The default compares the latest 50 reviewed errors with the calibration reference and includes uncertainty in both samples. Repeated testing and selective reviews still limit interpretation. Check the controlled experiment in Model Lab.</p></article>
  <article class="card"><div class="card-top"><h2>Recent checks and review</h2><span class="tag neutral">FEATURES ONLY</span></div><p class="microcopy">${summary.excludedCount?`${summary.excludedCount} rules-only or incompatible records are excluded from model metrics. `:''}Message text is not retained. Review only when you can refer to the original evidence. Latest 10 shown.</p>${list.length?`<div class="table-wrap"><table><thead><tr><th>Check</th><th>Model assessment</th><th>Words / links</th><th>Label review</th></tr></thead><tbody>${list.slice(-10).reverse().map(row=>`<tr><td><strong>${escape(new Date(row.timestamp).toLocaleString('en-IN'))}</strong><small>${escape(row.id.slice(0,12))}${demoMode?' · synthetic':''}</small></td><td>${row.score===null?'Rules only':percent(row.score)}<br><small>${escape(predictionNames[row.prediction])}</small></td><td>${row.features.wordCount} / ${row.features.urlCount}</td><td>${reviewControls(row,'monitor')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty-note">Your first check will appear here. Nothing has been prefilled into your session.</p>'}</article>`;
}
$('session-mode').addEventListener('click',()=>{demoMode=false;$('notice').hidden=true;renderMonitoring();});
$('demo-mode').addEventListener('click',()=>{demoMode=true;$('notice').hidden=true;renderMonitoring();if(!model)notice('Load the smishing model to generate the synthetic demonstration.');});
document.addEventListener('change',event=>{
  const id=event.target.dataset.label;if(!id)return;
  const row=recordsForReview().find(record=>record.id===id);if(!row)return;
  row.label=['smishing','non_smishing'].includes(event.target.value)?event.target.value:null;row.reviewed=false;row.reviewedAt=null;
  const saved=persist();refreshReview();if(saved)notice('Proposed label saved. It is excluded from performance until you confirm the review.');
});
function recordsForReview(){return activeView==='monitoring'&&demoMode?demoRecords:sessionRecords;}
function refreshReview(){if(activeView==='monitoring')renderMonitoring();else if(latest)renderResult(latest);}
document.addEventListener('click',event=>{
  const id=event.target.dataset.confirm;if(!id)return;
  const row=recordsForReview().find(record=>record.id===id);if(!row?.label||row.modelVersion!==ENGINE_VERSION)return;
  row.reviewed=true;row.reviewedAt=new Date(Math.max(Date.now(),Date.parse(row.timestamp))).toISOString();
  const saved=persist();refreshReview();if(saved)notice('Review confirmed. Review arrival time is recorded; abstentions remain separate in performance metrics.');
});
$('export').addEventListener('click',()=>{
  const exported=records().map(row=>cleanRecord(row,{allowSynthetic:demoMode})).filter(Boolean);
  const payload={schemaVersion:2,exportedAt:new Date().toISOString(),dataset:demoMode?'synthetic-demo':'browser-session',modelVersion:ENGINE_VERSION,signalsVersion:SIGNALS_VERSION,referenceId:reference?.id??null,limitations:'Derived features only; operator-confirmed labels; abstentions separate; statistical assumptions and repeated-testing limitations apply; no raw message content.',summary:monitorResearchRecords(exported,reference),records:exported};
  if(exportUrl)URL.revokeObjectURL(exportUrl);
  exportUrl=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  notice('Export ready. Message text and model explanations are excluded. ');
  const link=document.createElement('a');link.href=exportUrl;link.download=`scamshield-${demoMode?'synthetic-demo':'session'}.json`;link.textContent='Download export';$('notice').append(link);link.click();
});
$('clear').addEventListener('click',()=>{
  if(demoMode)return;
  if(!confirm('Clear all check history and review labels saved by this project in this browser, including the earlier prototype? Export current records first if you need a copy.'))return;
  sessionRecords=[];latest=null;let removed=true;
  try{localStorage.removeItem(STORAGE_KEY);localStorage.removeItem('scamshield-records-v1');hasLegacyHistory=false;}catch{removed=false;}
  renderMonitoring();$('message').value='';$('char-count').textContent='0';
  $('result').innerHTML='<div class="card-top"><h2>Your assessment</h2><span class="tag neutral">AWAITING INPUT</span></div><div class="empty-state"><h3>Ready for a fresh check.</h3><p>Paste an English message to inspect it.</p></div>';
  notice(removed?'Saved project history and review labels cleared. Synthetic examples stay separate.':'The displayed history is cleared, but saved browser data could not be fully removed. Clear this site’s data in your browser settings.');
});
function renderLab(){
  const chosen=metrics?.models?.tfidf;
  $('model-metrics').innerHTML=!chosen?'<p>Research results are unavailable. Retry loading to restore the experiment metadata.</p>':`<div class="metric-grid">${metric('Smishing precision',percent(chosen.precision),'Binary threshold 0.5')}${metric('Smishing recall',percent(chosen.recall),'Binary threshold 0.5')}${metric('Smishing F1',percent(chosen.f1))}${metric('Test messages',metrics.split.testRows,'Grouped held-out evaluation')}</div><div class="table-wrap"><table><thead><tr><th>Model</th><th>Precision</th><th>Recall</th><th>F1</th><th>Average precision</th><th>Brier</th></tr></thead><tbody>${Object.entries(metrics.models).map(([key,m])=>`<tr><td><strong>${escape(m.name??key)}</strong></td><td>${percent(m.precision)}</td><td>${percent(m.recall)}</td><td>${percent(m.f1)}</td><td>${decimal(m.prAuc,3)}</td><td>${decimal(m.brier,3)}</td></tr>`).join('')}</tbody></table></div><p>${metrics.split.trainRows} training · ${metrics.split.calibrationRows} calibration · ${metrics.split.testRows} test messages. ${escape(metrics.split.method)}. Seed ${metrics.split.seed}. Shared templates are grouped before splitting; those groups are approximations, not verified campaigns.</p><p><strong>Deployed choice:</strong> ${escape(metrics.deployment.reason)}</p><p>At the binary threshold: ${chosen.confusion.tp} detected smishing, ${chosen.confusion.fn} missed smishing, ${chosen.confusion.fp} non-smishing flagged, ${chosen.confusion.tn} correctly unflagged.</p><p>Accepted-decision coverage: ${percent(chosen.selective.coverage)} · ${chosen.selective.reviewCount} sent for review · Accuracy among accepted: ${percent(chosen.selective.accuracy)}. Abstention does not guarantee that accepted predictions are correct.</p><p>Calibration Brier score on the test set: ${decimal(chosen.rawBrier,4)} before, ${decimal(chosen.brier,4)} after. Lower is better. ${chosen.brier>chosen.rawBrier?'Calibration did not improve this held-out Brier score.':''}</p><p>Non-smishing false positives by original class: legitimate ${chosen.classFalsePositives.legitimate.count}/${chosen.classFalsePositives.legitimate.total}; spam ${chosen.classFalsePositives.spam.count}/${chosen.classFalsePositives.spam.total}.</p><p class="microcopy">${(metrics.limitations??[]).map(escape).join(' ')}</p><p><a href="https://github.com/yizhu-joy/SmishX" target="_blank" rel="noopener noreferrer">SmishX research dataset and authors ↗</a></p>`;
  renderExperimentResults();
  $('historical-metrics').innerHTML=baseline?`<p>The earlier UCI SMS spam baseline achieved precision ${percent(baseline.metrics.precision)}, recall ${percent(baseline.metrics.recall)}, and F1 ${percent(baseline.metrics.f1)} on ${baseline.split.testRows} held-out historical SMS messages.</p><p>This is a different task and dataset. Its scores cannot be directly compared with the smishing experiment above, and it is not used for current assessments.</p><p><a href="https://archive.ics.uci.edu/dataset/228/sms+spam+collection" target="_blank" rel="noopener noreferrer">UCI SMS Spam Collection ↗</a> · Almeida and Hidalgo, 2011 · CC BY 4.0.</p>`:'<p>The archived spam-baseline metadata is unavailable.</p>';
}
function renderExperimentResults(){
  $('monitoring-experiment').innerHTML=monitoringExperiment?renderExperiment(monitoringExperiment,'monitoring'):'<p>Controlled monitoring results are unavailable. Retry loading to restore them.</p>';
  $('robustness-results').innerHTML=robustness?renderExperiment(robustness,'robustness'):'<p>Robustness results are unavailable. Retry loading to restore them.</p>';
}
function renderExperiment(data,kind){
  if(kind==='monitoring'){
    const input=data.inputMonitoring??{}, error=data.errorMonitoring??{};
    const stable=input.scenarios?.stable, abrupt=input.scenarios?.abrupt, gradual=input.scenarios?.gradual;
    const scenarios=error.scenarios??{}, methods=Object.keys(scenarios.stable??{});
    const names={fixed_window:'Fixed window',ewma:'Exploratory EWMA',ewma_delayed_labels:'EWMA with delayed labels',hoeffding_snapshot:'Conservative snapshot',hoeffding_snapshot_delayed_labels:'Conservative snapshot with delayed labels'};
    return `<p>${data.runsPerScenario} seeded runs per scenario, ${data.streamLength} events per run. Controlled changes begin at event ${data.onsetIndexZeroBased+1}. Input and error experiments use separate synthetic streams.</p><h3>Input distribution detector</h3><div class="metric-grid">${metric('Stable streams with an alert',percent(stable?.stableRunFalseAlarmRate),'Repeated checks across one stream')}${metric('Abrupt change detected',percent(abrupt?.detectionRate),`${abrupt?.undetectedAfterChange??'—'} runs undetected`)}${metric('Abrupt change delay',Number.isFinite(abrupt?.medianDelayEventsAmongDetected)?decimal(abrupt.medianDelayEventsAmongDetected,0)+' events':'—','Median among detected runs')}${metric('Gradual change delay',Number.isFinite(gradual?.medianDelayEventsAmongDetected)?decimal(gradual.medianDelayEventsAmongDetected,0)+' events':'—','Median among detected runs')}</div><p>${escape(input.shiftDefinition??'')}</p><h3>Reviewed error detectors</h3><p>Simulated error rises from ${percent(error.baselineError)} to ${percent(error.postChangeError)}. The delayed-label condition waits ${error.labelDelayEvents} events for outcomes. Delays below are measured from change onset and only among detected runs.</p><div class="table-wrap"><table class="experiment-table"><thead><tr><th>Detector</th><th>Stable false alarms</th><th>Abrupt detection</th><th>Abrupt delay</th><th>Gradual detection</th><th>Gradual delay</th></tr></thead><tbody>${methods.map(key=>{const st=scenarios.stable[key],ab=scenarios.abrupt?.[key],gr=scenarios.gradual?.[key];return `<tr><td><strong>${escape(names[key]??key)}</strong></td><td>${percent(st.stableRunFalseAlarmRate)}</td><td>${percent(ab?.detectionRate)}<small>${ab?.undetectedAfterChange??'—'} undetected</small></td><td>${decimal(ab?.medianDelayEventsAmongDetected,1)}</td><td>${percent(gr?.detectionRate)}<small>${gr?.undetectedAfterChange??'—'} undetected</small></td><td>${decimal(gr?.medianDelayEventsAmongDetected,1)}</td></tr>`;}).join('')}</tbody></table></div><p>The dashboard uses the conservative snapshot comparison. The exploratory EWMA produced alerts on ${percent(scenarios.stable?.ewma?.stableRunFalseAlarmRate)} of stable simulated streams; it is retained as a research comparison. Conservative thresholds can delay or miss changes.</p><p class="microcopy">${(data.limitations??[]).map(escape).join(' ')}</p>`;
  }
  const overall=data.overall??{}, categories=Object.entries(data.categories??{}),pairs=data.pairs??[];
  const changed=pairs.filter(p=>p.binaryPredictionChanged).length;
  return `<p>${overall.count??'—'} authored English cases probe negation, ordinary payments, obfuscation, and uncertain context. These cases were not used to fit the model and are not an independent real-world benchmark.</p><div class="metric-grid">${metric('Binary F1',percent(overall.rawF1),`${overall.labelledCount??'—'} labelled diagnostic cases`)}${metric('Binary accuracy',percent(overall.rawAccuracy),'Includes underlying abstained predictions')}${metric('Accepted coverage',percent(overall.labelledCoverage),'Among labelled cases')}${metric('Ambiguous cases reviewed',percent(overall.ambiguousReviewRate),`${overall.ambiguousCount??'—'} ambiguous cases`)}</div><div class="table-wrap"><table class="experiment-table"><thead><tr><th>Category</th><th>Cases</th><th>Binary accuracy</th><th>Accepted coverage</th><th>Accepted accuracy</th></tr></thead><tbody>${categories.map(([name,row])=>`<tr><td><strong>${escape(name.replaceAll('_',' '))}</strong></td><td>${row.count}</td><td>${percent(row.rawAccuracy)}</td><td>${percent(row.labelledCoverage)}</td><td>${percent(row.selectiveAccuracy)}</td></tr>`).join('')}</tbody></table></div><p>${overall.reviewCount??'—'} cases were sent for human review. Accepted-decision accuracy was ${percent(overall.selectiveAccuracy)}; it applies only to the selected subset. ${changed} of ${pairs.length} paired transformations changed the underlying binary prediction.</p><p class="microcopy">${Array.isArray(data.limitations)?data.limitations.map(escape).join(' '):escape(data.limitations??'Diagnostic outcomes reveal weaknesses; no claim of adversarial safety is made. Cases and paired variants are related, so these counts are descriptive.')}</p>`;
}
async function fetchJson(path){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const response=await fetch(path,{cache:'no-cache',signal:controller.signal});if(!response.ok)throw new Error(`Unable to load ${path}`);return await response.json();}
  finally{clearTimeout(timer);}
}
async function loadAssets(){
  if(loading)return;loading=true;$('analyze').disabled=true;$('reload-models').disabled=true;$('load-state').textContent='Loading model and research results…';
  const paths=[['model','./data/smishing-model.json'],['reference','./data/monitoring-reference.json'],['metrics','./data/smishing-metrics.json'],['baseline','./data/baseline-metrics.json'],['monitoring experiment','./data/monitoring-results.json'],['robustness experiment','./data/robustness-results.json']];
  const results=await Promise.allSettled(paths.map(([,path])=>fetchJson(path)));
  const errors=[];const values=results.map((result,i)=>{if(result.status==='fulfilled')return result.value;errors.push(paths[i][0]);return null;});
  [model,reference,metrics,baseline,monitoringExperiment,robustness]=values;
  if(model&&!validateSmishingModel(model)){model=null;errors.push('model validation');}
  if(metrics&&metrics.modelVersion!==ENGINE_VERSION){metrics=null;errors.push('result version validation');}
  if(model){try{demoRecords=makeDemoRecords(model);}catch{model=null;demoRecords=[];errors.push('model inference');}}
  $('load-state').textContent=errors.length?`${model?'Model ready.':'Rules only: smishing model unavailable.'} Could not load ${errors.join(', ')}.`:'English smishing model ready · Messages are processed in this browser';
  $('reload-models').hidden=!errors.length;$('reload-models').disabled=false;$('analyze').disabled=false;loading=false;
  renderLab();if(activeView==='monitoring')renderMonitoring();
}
$('reload-models').addEventListener('click',loadAssets);
switchView(location.hash.slice(1));
loadAssets();
