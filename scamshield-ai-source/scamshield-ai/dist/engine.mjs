import { predictSmishing } from './smishing-model.mjs';

export const ENGINE_VERSION = 'smishing-tfidf-v1';
export const SIGNALS_VERSION = 'signals-0.2.0';
export const MAX_MESSAGE_LENGTH = 12000;
const RULES = [
  {id:'credential', title:'Request for sensitive credentials', weight:45, pattern:/\b(?:share|send|provide|enter|confirm|verify|reveal|reply with|give)\b.{0,65}\b(?:otp|one[- ]time (?:password|code)|password|pin|cvv|verification code|bank details|card details)\b/i, detail:'The message asks for credentials or sensitive financial details. Verify the sender through a trusted channel.'},
  {id:'advance-fee', title:'Upfront payment tied to an opportunity', weight:45, pattern:/(?:\b(?:internship|job|offer|scholarship|prize|lottery|reward|hired)s?\b.{0,140}\b(?:pay|payment|deposit|fee|transfer)s?\b|\b(?:pay|payment|deposit|fee|transfer)s?\b.{0,140}\b(?:internship|job|offer|scholarship|prize|lottery|reward|hired)s?\b)/i, detail:'Payment is linked to a job, benefit, or prize. This combination deserves independent verification; it is not proof of fraud.'},
  {id:'urgency', title:'Pressure to act quickly', weight:15, pattern:/\b(?:immediately|urgent|within \d+ (?:minutes?|hours?)|act now|last chance|expires? (?:today|soon)|final warning)\b/i, detail:'Urgency can discourage careful checking. It also occurs in legitimate messages.'},
  {id:'threat', title:'Threat of account or service loss', weight:20, pattern:/\b(?:account|access|service|card)\b.{0,55}\b(?:suspend(?:ed)?|block(?:ed)?|terminat(?:ed|ion)|deactivat(?:ed|ion)|restrict(?:ed)?|clos(?:ed|ure))\b/i, detail:'The message threatens loss of access. Open the official service yourself to check.'},
  {id:'guarantee', title:'Unrealistic financial promise', weight:35, pattern:/\b(?:guaranteed (?:returns?|profits?|income)|risk[- ]free (?:investment|returns?|profit)|double your money|\d+% (?:daily|weekly) (?:returns?|profit))\b/i, detail:'Guaranteed or unusually fast returns are a reason to investigate the claim.'},
  {id:'unusual-payment', title:'Hard-to-reverse payment request', weight:30, pattern:/\b(?:pay|send|transfer|purchase|buy)\b.{0,60}\b(?:gift cards?|bitcoin|crypto(?:currency)?|usdt)\b/i, detail:'The requested payment method may offer limited recovery options. Confirm the purpose and recipient independently.'}
];
const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
function urls(text) { return text.match(urlPattern) || []; }
function excerpt(text, match) { return match ? text.slice(match.index, Math.min(match.index + match[0].length, match.index + 160)) : ''; }
export function extractFeatures(text) {
  const normalized=text.replace(/\s+/g,' ');
  return {length:text.length, wordCount:(text.match(/\S+/g)||[]).length, urlCount:urls(text).length,
    urgency:/\b(?:urgent|immediately|act now|final warning|within \d+ (?:minutes?|hours?))\b/i.test(normalized)?1:0,
    payment:/\b(?:pay|payment|deposit|fee|transfer|bitcoin|crypto|gift card)\b/i.test(normalized)?1:0,
    credential:/\b(?:otp|password|pin|cvv|verification code|bank details)\b/i.test(normalized)?1:0,
    nonAsciiRatio:text.length ? (text.match(/[^\x00-\x7F]/g)||[]).length/text.length : 0};
}
export function analyzeMessage(input, model=null) {
  if(typeof input!=='string'||!input.trim()) throw new Error('Paste a message before checking it.');
  if(input.length>MAX_MESSAGE_LENGTH) throw new Error('Please keep messages under 12,000 characters.');
  const text=input.trim(), normalized=text.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,' ');
  const evidence=[];
  for(const rule of RULES) { const match=rule.pattern.exec(normalized); if(match) evidence.push({id:rule.id,title:rule.title,detail:rule.detail,snippet:excerpt(normalized,match),weight:rule.weight}); }
  const links=urls(text);
  const shortLink=links.find(link=>{try{return /^(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|shorturl\.at|rb\.gy)$/i.test(new URL(link.startsWith('www.')?'https://'+link:link).hostname);}catch{return false;}});
  if(shortLink) evidence.push({id:'short-link',title:'Destination hidden by a short link',detail:'A shortened link hides its final destination. This is a weak signal, not a malicious-link verdict. No links are opened by this app.',snippet:shortLink,weight:10});
  const ipLink=links.find(link=>{try{return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(new URL(link.startsWith('www.')?'https://'+link:link).hostname);}catch{return false;}});
  if(ipLink) evidence.push({id:'ip-link',title:'Link uses a numerical address',detail:'A numerical host instead of a named domain is unusual in customer-facing messages. Context matters.',snippet:ipLink,weight:15});
  const riskScore=Math.min(100,evidence.reduce((sum,e)=>sum+e.weight,0));
  const smishing=model?predictSmishing(text,model):null;
  return {id:globalThis.crypto?.randomUUID?.()||'check-'+Date.now()+'-'+Math.random().toString(16).slice(2),timestamp:new Date().toISOString(),riskScore,
    riskBand:riskScore>=55?'High concern':riskScore>=25?'Some warning signals':'Few warning signals',
    prediction:smishing?.prediction??'review',binaryPrediction:smishing?.binaryPrediction??null,
    score:smishing?.score??null,rawScore:smishing?.rawScore??null,coverage:smishing?.coverage??null,
    evidence,features:extractFeatures(text),smishing,modelVersion:smishing?.modelVersion??SIGNALS_VERSION,signalsVersion:SIGNALS_VERSION};
}
export const FEATURE_KEYS=['length','wordCount','urlCount','urgency','payment','credential','nonAsciiRatio'];
const isProbability=n=>Number.isFinite(n)&&n>=0&&n<=1;
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function cleanRecord(row,{allowSynthetic=false}={}) {
  if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id.length||row.id.length>100||!validDate(row.timestamp)||![ENGINE_VERSION,SIGNALS_VERSION].includes(row.modelVersion)||!Number.isFinite(row.riskScore)||row.riskScore<0||row.riskScore>100||!row.features||!FEATURE_KEYS.every(key=>Number.isFinite(row.features[key]))||(!allowSynthetic&&row.synthetic===true)) return null;
  const f=row.features;
  if(!Number.isInteger(f.length)||!Number.isInteger(f.wordCount)||!Number.isInteger(f.urlCount)||f.length<0||f.length>MAX_MESSAGE_LENGTH||f.wordCount<0||f.wordCount>MAX_MESSAGE_LENGTH||f.urlCount<0||f.urlCount>MAX_MESSAGE_LENGTH||![0,1].includes(f.urgency)||![0,1].includes(f.payment)||![0,1].includes(f.credential)||!isProbability(f.nonAsciiRatio)) return null;
  const modelAvailable=row.modelVersion===ENGINE_VERSION;
  if(modelAvailable&&(!isProbability(row.score)||!isProbability(row.rawScore)||!isProbability(row.coverage)||!['smishing','non_smishing','review'].includes(row.prediction)||!['smishing','non_smishing'].includes(row.binaryPrediction)||row.binaryPrediction!==(row.score>=0.5?'smishing':'non_smishing')||(row.prediction!=='review'&&row.prediction!==row.binaryPrediction))) return null;
  const label=['smishing','non_smishing'].includes(row.label)?row.label:null;
  const reviewed=modelAvailable&&label!==null&&row.reviewed===true&&validDate(row.reviewedAt)&&Date.parse(row.reviewedAt)>=Date.parse(row.timestamp);
  return {id:row.id,timestamp:row.timestamp,riskScore:row.riskScore,riskBand:row.riskScore>=55?'High concern':row.riskScore>=25?'Some warning signals':'Few warning signals',
    prediction:modelAvailable?row.prediction:'review',binaryPrediction:modelAvailable?row.binaryPrediction:null,
    score:modelAvailable?row.score:null,rawScore:modelAvailable?row.rawScore:null,coverage:modelAvailable?row.coverage:null,
    features:Object.fromEntries(FEATURE_KEYS.map(key=>[key,f[key]])),modelVersion:row.modelVersion,signalsVersion:SIGNALS_VERSION,
    label:modelAvailable?label:null,reviewed,reviewedAt:reviewed?row.reviewedAt:null,...(allowSynthetic&&row.synthetic===true?{synthetic:true}:{})};
}
export function toRecord(a) {
  return cleanRecord({...a,label:null,reviewed:false,reviewedAt:null});
}
export function makeDemoRecords(model=null) {
  if(!model) return [];
  const messages=[
    ['Your order has shipped. Delivery is expected tomorrow.','non_smishing'],
    ['Can we meet at the library at 4? Please bring the notes.','non_smishing'],
    ['Your internship interview is scheduled for Tuesday at 10 am.','non_smishing'],
    ['Congratulations on your internship offer! Pay a registration fee of Rs 2500 immediately to confirm your seat.','smishing'],
    ['Your account will be suspended. Share your OTP immediately at https://bit.ly/example','smishing'],
    ['Please pay the college examination fee before the published deadline.','non_smishing'],
    ['You have won a cash prize. Pay the processing fee to claim your reward now.','smishing'],
    ['Your scholarship application is received. The office never asks you to pay a processing fee.','non_smishing']
  ];
  const start=Date.UTC(2026,0,1,9);
  return Array.from({length:60},(_,i)=>{
    const [message,label]=messages[i%messages.length];
    const extra=i>=30?' Reference and verification instructions are included in this illustrative sample. '.repeat(9):'';
    const record=toRecord(analyzeMessage(message+extra,model));
    return {...record,id:'demo-'+i,timestamp:new Date(start+i*3600000).toISOString(),label,reviewed:true,reviewedAt:new Date(start+(i+2)*3600000).toISOString(),synthetic:true};
  });
}
