// Numerical inference for the frozen word/character TF-IDF logistic model.
// Feature contributions are signed raw-logit terms, not causal explanations.
const VERSION = 'smishing-tfidf-v1';
const prepared = new WeakMap();
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const finite = n => typeof n === 'number' && Number.isFinite(n);
export function validateSmishingModel(model) {
  if (!model || model.schemaVersion !== 1 || model.version !== VERSION || model.preprocessing !== 'nfkc-lower-ascii-mask-url-email-number-v1' || model.sublinearTf !== true || !finite(model.intercept)) return false;
  for (const key of ['word','char']) {
    const b=model[key];
    if (!b || !Array.isArray(b.terms) || !b.terms.length || b.terms.length>100000 || !Array.isArray(b.idf) || !Array.isArray(b.coefficients) || b.idf.length!==b.terms.length || b.coefficients.length!==b.terms.length || new Set(b.terms).size!==b.terms.length) return false;
    if (!b.terms.every(t=>typeof t==='string'&&t.length>0&&t.length<500) || !b.idf.every(n=>finite(n)&&n>0) || !b.coefficients.every(finite)) return false;
    if (JSON.stringify(b.ngramRange)!==JSON.stringify(key==='word'?[1,2]:[3,5])) return false;
  }
  const c=model.calibration,a=model.abstain;
  return !!c && finite(c.slope) && finite(c.intercept) && !!a && finite(a.low) && a.low>=0 && a.low<0.5 && finite(a.high) && a.high>0.5 && a.high<=1 && finite(a.minCoverage) && a.minCoverage>=0 && a.minCoverage<=1 && Number.isInteger(a.minWords) && a.minWords>=1;
}
export function preprocessSmishing(text) {
  return text.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'').toLowerCase()
    .replace(/\\[rnt]/g,' ')
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi,' zzurl ')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,' zzemail ')
    .replace(/[0-9]+/g,' zznumber ')
    .replace(/[^\x20-\x7e]/g,' ').replace(/\s+/g,' ').trim();
}
const sigmoid = x => x>=0 ? 1/(1+Math.exp(-x)) : Math.exp(x)/(1+Math.exp(x));
function prepare(model) {
  if (!prepared.has(model)) {
    if (!validateSmishingModel(model)) throw new Error('The smishing model is invalid or unsupported.');
    prepared.set(model,{word:new Map(model.word.terms.map((t,i)=>[t,i])),char:new Map(model.char.terms.map((t,i)=>[t,i]))});
  }
  return prepared.get(model);
}
function blockContributions(tokens,block,index,prefix) {
  const counts=new Map();
  for(const token of tokens) if(index.has(token)){const i=index.get(token);counts.set(i,(counts.get(i)||0)+1);}
  const values=[...counts].map(([i,count])=>[i,(1+Math.log(count))*block.idf[i]]);
  const norm=Math.sqrt(values.reduce((sum,[,value])=>sum+value*value,0));
  if(!norm)return [];
  return values.map(([i,value])=>({feature:prefix+block.terms[i],weight:value/norm*block.coefficients[i]}));
}
export function predictSmishing(text,model) {
  if(typeof text!=='string'||!text.trim())throw new Error('Enter an English message before checking it.');
  if(text.length>12000)throw new Error('Please keep messages under 12,000 characters.');
  const index=prepare(model),normalized=preprocessSmishing(text),words=normalized.match(/[a-z0-9]+/g)||[];
  const wordFeatures=[...words];for(let i=0;i<words.length-1;i++)wordFeatures.push(words[i]+' '+words[i+1]);
  const charFeatures=[];for(let n=3;n<=5;n++)for(let i=0;i<=normalized.length-n;i++)charFeatures.push(normalized.slice(i,i+n));
  const features=[...blockContributions(wordFeatures,model.word,index.word,'word: '),...blockContributions(charFeatures,model.char,index.char,'chars: ')];
  const logit=model.intercept+features.reduce((sum,item)=>sum+item.weight,0);
  const score=sigmoid(model.calibration.slope*logit+model.calibration.intercept),rawScore=sigmoid(logit);
  const knownTokenCount=words.filter(w=>index.word.has(w)).length,totalTokenCount=words.length;
  const coverage=totalTokenCount?knownTokenCount/totalTokenCount:0;
  const binaryPrediction=score>=0.5?'smishing':'non_smishing';
  let prediction=binaryPrediction,reason=score>=0.5?'The model score supports smishing; verify the message independently.':'The model score is below the smishing threshold. This does not establish safety.';
  if(totalTokenCount<model.abstain.minWords){prediction='review';reason='Too little text for a reliable assessment.';}
  else if(coverage<model.abstain.minCoverage){prediction='review';reason='Too few words match the training vocabulary.';}
  else if(score>model.abstain.low&&score<model.abstain.high){prediction='review';reason='The score lies in the review interval; the model defers this decision.';}
  return {score,rawScore,prediction,binaryPrediction,coverage,knownTokenCount,totalTokenCount,topFeatures:features.sort((a,b)=>Math.abs(b.weight)-Math.abs(a.weight)||a.feature.localeCompare(b.feature)).slice(0,8),modelVersion:model.version,reason};
}
