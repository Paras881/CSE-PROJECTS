"""Train fixed research candidates with group-disjoint splits and calibration.

No raw corpus or fitted encoder weights are copied into the application.
Run from the repository root; see MODEL_V2.md for the full reproducible command.
"""
import argparse
import hashlib
import json
import math
import os
import platform
import re
import time
from collections import Counter
from pathlib import Path

import numpy as np
import scipy.sparse as sp
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold
from audit_smishx import preprocess, WORDS, URL

VERSION = 'smishing-tfidf-v1'
SEED = 2030
ABSTAIN = {'low': 0.25, 'high': 0.75, 'minCoverage': 0.2, 'minWords': 3}
ENCODER = 'sentence-transformers/all-MiniLM-L6-v2'
ENCODER_REVISION = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41'


def word_ngrams(text):
    words = WORDS.findall(text)
    return words + [' '.join(words[i:i+2]) for i in range(len(words)-1)]


def char_ngrams(text):
    return [text[i:i+n] for n in range(3, 6) for i in range(len(text)-n+1)]


def sigmoid(values):
    values = np.asarray(values, dtype=float)
    return np.exp(-np.logaddexp(0, -values))


def wilson(k, n):
    if not n:
        return [None, None]
    z = 1.959963984540054
    center = (k/n + z*z/(2*n))/(1+z*z/n)
    radius = z*math.sqrt(k/n*(1-k/n)/n+z*z/(4*n*n))/(1+z*z/n)
    return [max(0, center-radius), min(1, center+radius)]


def counts_metrics(y, predicted):
    tn, fp, fn, tp = confusion_matrix(y, predicted, labels=[0, 1]).ravel().tolist()
    ratio = lambda a,b: a/b if b else None
    return {'precision': ratio(tp,tp+fp), 'recall': ratio(tp,tp+fn),
            'f1': ratio(2*tp,2*tp+fp+fn), 'accuracy': ratio(tp+tn,len(y)),
            'confusion': {'tp':tp,'fp':fp,'tn':tn,'fn':fn},
            'intervals': {'precision':wilson(tp,tp+fp),'recall':wilson(tp,tp+fn),'accuracy':wilson(tp+tn,len(y))}}


def bootstrap_f1(y, predicted, groups, repetitions=1000):
    unique = sorted(set(groups.tolist()))
    indexes = {g:np.flatnonzero(groups == g) for g in unique}
    rng = np.random.default_rng(SEED)
    scores = []
    for _ in range(repetitions):
        idx = np.concatenate([indexes[g] for g in rng.choice(unique,len(unique),replace=True)])
        # Direct arithmetic avoids expensive sklearn validation on each resample.
        yy, pp = y[idx], predicted[idx]
        tp, fp, fn = int(np.sum((yy==1)&(pp==1))), int(np.sum((yy==0)&(pp==1))), int(np.sum((yy==1)&(pp==0)))
        den = 2*tp+fp+fn
        if den: scores.append(2*tp/den)
    return np.quantile(scores,[0.025,0.975]).tolist() if scores else [None,None]


def evaluate(y, score, raw_score, labels, accepted, groups):
    predicted = (score >= 0.5).astype(int)
    result = counts_metrics(y,predicted)
    result.update({'prAuc':float(average_precision_score(y,score)),
                   'brier':float(brier_score_loss(y,score)),
                   'rawBrier':float(brier_score_loss(y,raw_score))})
    result['intervals']['f1GroupBootstrap'] = bootstrap_f1(y,predicted,groups)
    selected = counts_metrics(y[accepted],predicted[accepted]) if np.any(accepted) else {'accuracy':None,'precision':None,'recall':None,'f1':None,'confusion':{'tp':0,'fp':0,'tn':0,'fn':0}}
    result['selective'] = {**selected,'coverage':float(np.mean(accepted)), 'acceptedCount':int(np.sum(accepted)), 'reviewCount':int(np.sum(~accepted))}
    result['classFalsePositives'] = {label:{'count':int(np.sum((labels==label)&(predicted==1))), 'total':int(np.sum(labels==label)), 'rate':float(np.mean(predicted[labels==label])) if np.any(labels==label) else None} for label in ('legitimate','spam')}
    result['reliabilityBins'] = []
    for i in range(5):
        mask = (score>=i/5)&((score<(i+1)/5) if i<4 else (score<=1))
        result['reliabilityBins'].append({'lower':i/5,'upper':(i+1)/5,'count':int(mask.sum()),'meanScore':float(score[mask].mean()) if mask.any() else None,'observedRate':float(y[mask].mean()) if mask.any() else None})
    return result


def calibration(logits, y):
    fitted = LogisticRegression(C=1.0, solver='lbfgs', max_iter=2000, random_state=SEED).fit(logits.reshape(-1,1),y)
    return {'slope':float(fitted.coef_[0,0]),'intercept':float(fitted.intercept_[0]),'method':'Regularized Platt sigmoid; calibration split only; C=1'}


def apply_calibration(logits, cal):
    return sigmoid(logits*cal['slope']+cal['intercept'])


def word_coverage(text, vocabulary):
    words = WORDS.findall(preprocess(text))
    return (sum(w in vocabulary for w in words)/len(words) if words else 0),len(words)


def selected_mask(scores, coverage, count):
    return ((scores<=ABSTAIN['low'])|(scores>=ABSTAIN['high']))&(coverage>=ABSTAIN['minCoverage'])&(count>=ABSTAIN['minWords'])


def json_write(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=True,indent=2,allow_nan=False)+'\n')


def feature_values(rows):
    return {'length':sorted(len(r['text'].strip().encode('utf-16-le'))//2 for r in rows),
            'wordCount':sorted(len(re.findall(r'\S+',r['text'])) for r in rows),
            'urlCount':sorted(len(URL.findall(r['text'])) for r in rows)}


def main(args):
    start = time.perf_counter()
    rows = [json.loads(line) for line in args.data.read_text().splitlines() if line.strip()]
    audit = json.loads((args.data.parent/'audit.json').read_text())
    labels = np.array([r['label'] for r in rows])
    y = (labels=='smishing').astype(int)
    groups = np.array([r['group'] for r in rows])
    text = [preprocess(r['text']) for r in rows]
    splitter = StratifiedGroupKFold(n_splits=5,shuffle=True,random_state=SEED)
    folds = [test for _,test in splitter.split(text,labels,groups)]
    test, cal = folds[0],folds[1]
    train = np.sort(np.concatenate(folds[2:]))
    sets = {name:set(groups[idx]) for name,idx in [('train',train),('calibration',cal),('test',test)]}
    assert not (sets['train']&sets['calibration'] or sets['train']&sets['test'] or sets['calibration']&sets['test'])
    split_name={int(i):name for name,idx in [('train',train),('calibration',cal),('test',test)] for i in idx}
    protocol = {'version':VERSION,'seed':SEED,'target':'smishing vs legitimate + spam','datasetSha256':audit['sha256'],
                'split':'StratifiedGroupKFold 5 folds; fold0 test, fold1 calibration, folds2-4 train. Stratified on original3 labels.',
                'grouping':audit['grouping'],'lexicalC':1.0,'embeddingC':1.0,'calibrationC':1.0,'abstain':ABSTAIN,
                'wordNgrams':[1,2],'charNgrams':[3,5],'minDf':2,'maxWordFeatures':12000,'maxCharFeatures':20000,
                'encoder':ENCODER,'encoderRevision':ENCODER_REVISION,'encoderFineTuned':False,
                'selection':'Fixed model/hyperparameters before test evaluation. Lexical model deployed for browser size and local inference, not selected by test score.'}
    manifest = {'protocol':protocol,'rows':[{'id':r['id'],'group':r['group'],'label':r['label'],'split':split_name[i]} for i,r in enumerate(rows)]}
    manifest_path=args.results/'split-manifest.json'
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != manifest:
        raise ValueError('Frozen manifest mismatch: use a new version for a changed protocol or data.')
    json_write(manifest_path,manifest)
    print('Frozen split:',{name:len(idx) for name,idx in [('train',train),('calibration',cal),('test',test)]},flush=True)
    # Fit both vocabularies and IDF strictly on training examples.
    word=TfidfVectorizer(analyzer=word_ngrams,min_df=2,max_features=12000,sublinear_tf=True,dtype=np.float64)
    char=TfidfVectorizer(analyzer=char_ngrams,min_df=2,max_features=20000,sublinear_tf=True,dtype=np.float64)
    word.fit([text[i] for i in train]);char.fit([text[i] for i in train])
    X=sp.hstack((word.transform(text),char.transform(text)),format='csr')
    lexical=LogisticRegression(C=1.0,solver='liblinear',max_iter=2000,random_state=SEED).fit(X[train],y[train])
    lexical_logits=lexical.decision_function(X)
    lexical_cal=calibration(lexical_logits[cal],y[cal])
    nword=len(word.vocabulary_)
    def block(vector,coefficients,ngram_range):
        return {'terms':vector.get_feature_names_out().tolist(),'idf':vector.idf_.tolist(),'coefficients':coefficients.tolist(),'ngramRange':ngram_range}
    model={'schemaVersion':1,'version':VERSION,'task':'English SMS smishing vs non-smishing','preprocessing':'nfkc-lower-ascii-mask-url-email-number-v1',
           'word':block(word,lexical.coef_[0,:nword],[1,2]),'char':block(char,lexical.coef_[0,nword:],[3,5]),
           'intercept':float(lexical.intercept_[0]),'calibration':lexical_cal,'abstain':ABSTAIN,'sublinearTf':True,
           'fitRows':len(train),'datasetSha256':audit['sha256'],'createdDate':'2026-11-07'}
    json_write(args.dist/'smishing-model.json',model)
    coverage_count=[word_coverage(r['text'],word.vocabulary_) for r in rows]
    coverage=np.array([c for c,_ in coverage_count]);count=np.array([c for _,c in coverage_count])
    lexical_scores=apply_calibration(lexical_logits,lexical_cal)
    ref={'id':'training-reference-v1','modelVersion':VERSION,'source':'SmishX training split','trainingRows':len(train),
         'features':feature_values([rows[i] for i in train]),
         'errorRate':float(np.mean((lexical_scores[cal]>=0.5)!=y[cal])),
         'errorRateSource':'calibration-split','calibrationRows':len(cal),'errorRateRows':len(cal),'positiveDefinition':'smishing','binaryThreshold':0.5}
    json_write(args.dist/'monitoring-reference.json',ref)
    print('Browser lexical artifact and training reference written.',flush=True)
    # Only authored examples in public fixtures, never corpus excerpts.
    authored=['Your account is blocked. Enter your password now at https://example.invalid/verify.',
              'Our project review is on Tuesday. Please bring your notes.',
              'Never share your password or OTP with someone who contacts you.',
              'Pay the college examination fee through the official portal.',
              'You won a prize. Pay a fee immediately to claim it.',
              'qxzv plmok zzyx', 'hello', 'ＦＲＥＥ reward claim 123 at https://example.invalid/a',
              'Your pass\u200bword is needed urgently. Contact help@example.invalid.',
              'constructor __proto__ toString', '🍀Meeting at 10\u202fAM. Bring notes.']
    fixtureX=sp.hstack((word.transform([preprocess(t) for t in authored]),char.transform([preprocess(t) for t in authored])),format='csr')
    fixture_logits=lexical.decision_function(fixtureX)
    fixtures=[]
    for text_value,logit in zip(authored,fixture_logits):
        score=float(apply_calibration(np.array([logit]),lexical_cal)[0]);cov,n=word_coverage(text_value,word.vocabulary_)
        accepted=bool(selected_mask(np.array([score]),np.array([cov]),np.array([n]))[0])
        fixtures.append({'text':text_value,'score':score,'rawScore':float(sigmoid(logit)),'prediction':('smishing' if score>=0.5 else 'non_smishing') if accepted else 'review','coverage':cov,'totalTokenCount':n})
    json_write(args.dist/'smishing-fixtures.json',{'modelVersion':VERSION,'source':'Authored verification inputs, not training or test messages','fixtures':fixtures})
    # Frozen encoder representation; classifier fitted only on train and sigmoid on calibration.
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1';os.environ['TOKENIZERS_PARALLELISM']='false'
    import torch
    from sentence_transformers import SentenceTransformer
    torch.set_num_threads(2);torch.manual_seed(SEED)
    encoder=SentenceTransformer(str(args.encoder),device='cpu',local_files_only=True)
    encoder.max_seq_length=256
    embedding_start=time.perf_counter()
    embeddings=encoder.encode(text,batch_size=32,normalize_embeddings=True,show_progress_bar=False,convert_to_numpy=True)
    embedding_seconds=time.perf_counter()-embedding_start
    embedding_model=LogisticRegression(C=1.0,solver='liblinear',max_iter=2000,random_state=SEED).fit(embeddings[train],y[train])
    embedding_logits=embedding_model.decision_function(embeddings)
    embedding_cal=calibration(embedding_logits[cal],y[cal])
    embedding_scores=apply_calibration(embedding_logits,embedding_cal)
    print('Both candidates fitted and calibrated. Evaluating frozen test split.',flush=True)
    results={}
    for name,display,logits,scores in [('tfidf','Word and character TF-IDF logistic regression',lexical_logits,lexical_scores),('minilm','Frozen MiniLM embeddings and logistic regression',embedding_logits,embedding_scores)]:
        accepted=selected_mask(scores[test],coverage[test],count[test])
        result=evaluate(y[test],scores[test],sigmoid(logits[test]),labels[test],accepted,groups[test])
        result.update({'name':display,'testRows':len(test),'calibration':lexical_cal if name=='tfidf' else embedding_cal})
        results[name]=result
    always=np.zeros(len(test));results['alwaysNegative']=evaluate(y[test],always,always,labels[test],np.ones(len(test),dtype=bool),groups[test])
    results['alwaysNegative']['name']='Always predict non-smishing'
    # Cold model download and load excluded; measured inference over test batch after warmup.
    repeats=5;lexical_times=[]
    for _ in range(repeats):
        started=time.perf_counter();xt=sp.hstack((word.transform([text[i] for i in test]),char.transform([text[i] for i in test])),format='csr');lexical.decision_function(xt)
        lexical_times.append((time.perf_counter()-started)*1000/len(test))
    results['tfidf']['latencyMsPerMessage']=float(np.median(lexical_times))
    results['minilm']['latencyMsPerMessage']=embedding_seconds*1000/len(rows)
    results['minilm']['encoder']=ENCODER;results['minilm']['encoderRevision']=ENCODER_REVISION
    results['minilm']['fineTuned']=False
    split={'seed':SEED,'method':protocol['split'],'trainRows':len(train),'calibrationRows':len(cal),'testRows':len(test),
           'trainGroups':len(sets['train']),'calibrationGroups':len(sets['calibration']),'testGroups':len(sets['test']),
           'labelCounts':{name:dict(Counter(labels[idx].tolist())) for name,idx in [('train',train),('calibration',cal),('test',test)]}}
    metrics={'modelVersion':VERSION,'dataset':audit,'split':split,'models':results,'abstain':ABSTAIN,
             'deployment':{'chosen':'tfidf','reason':'Fixed before held-out evaluation: small numerical artifact, offline browser inference, no external AI service. Comparison model is a research benchmark, not deployed.'},
             'calibrationEvaluation':{'tfidf':{'before':results['tfidf']['rawBrier'],'after':results['tfidf']['brier']},'minilm':{'before':results['minilm']['rawBrier'],'after':results['minilm']['brier']}},
             'environment':{'python':platform.python_version(),'platform':platform.platform(),'sklearn':sklearn.__version__,'torch':torch.__version__,'cpuThreads':2,'latencyNote':'Machine-specific warmed batch throughput, not end-to-end browser latency. Lexical median of5 passes; MiniLM one whole-dataset encoding pass. Excludes model loading/download.'},
             'limitations':['Small curated sample and approximate template grouping; no source/campaign/chronological generalization claim.',
                            'Labels are inherited from the source authors; no independent relabelling or user study was conducted.',
                            'English-only scope excludes11 inspected non-English or corrupted messages; remaining short/transliterated text is not language-certified.',
                            'Spam and legitimate are both non-smishing; a negative result is not a safety verdict.',
                            'Masking URLs, emails and numbers prevents using domain reputation; active-URL source sampling creates selection bias.',
                            'Frozen encoder pretraining overlap with public SMS corpora cannot be ruled out.',
                            'Confidence calibration is sample-specific; review thresholds were fixed, not proven optimal.',
                            'Wilson intervals treat messages as independent; grouped bootstrap F1 partly accounts for template dependence.',
                            'MiniLM review coverage uses the same lexical coverage gate for comparability; it is not an embedding uncertainty measure.'],
             'runDate':'2026-11-07','elapsedSeconds':time.perf_counter()-start}
    json_write(args.dist/'smishing-metrics.json',metrics)
    json_write(args.results/'smishing-metrics.json',metrics)
    json_write(args.results/'data-audit.json',audit)
    # Derived test observations for paired monitoring experiments: no text, URLs or token features.
    json_write(args.results/'test-observations.json',{'modelVersion':VERSION,'source':'Frozen grouped test split; no natural chronology','records':[{'id':rows[i]['id'],'group':rows[i]['group'],'label':str(labels[i]),'target':int(y[i]),'score':float(lexical_scores[i]),'binaryPrediction':int(lexical_scores[i]>=0.5),'review':not bool(selected_mask(np.array([lexical_scores[i]]),np.array([coverage[i]]),np.array([count[i]]))[0]),'length':len(rows[i]['text'].encode('utf-16-le'))//2,'wordCount':len(re.findall(r'\S+',rows[i]['text'])),'urlCount':len(URL.findall(rows[i]['text']))} for i in test]})
    print(json.dumps({'split':split,'metrics':{k:{kk:v[kk] for kk in ('precision','recall','f1','brier','confusion','selective')} for k,v in results.items()}},indent=2),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',type=Path,required=True)
    parser.add_argument('--encoder',type=Path,required=True)
    parser.add_argument('--dist',type=Path,default=Path('dist/data'))
    parser.add_argument('--results',type=Path,default=Path('docs/results'))
    main(parser.parse_args())
