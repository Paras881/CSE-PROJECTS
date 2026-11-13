/** Local inference for the explicitly labelled SMS spam (not scam) baseline. */
export function tokenize(text) {
  return String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function predictSpam(text, model) {
  if (!model || model.schemaVersion !== 1 || model.task !== 'spam-vs-ham' || !model.vocabulary) {
    throw new Error('Unsupported or unavailable SMS spam model.');
  }
  const tokens = tokenize(text);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const scores = [...model.logPrior];
  const contributions = [];
  let knownTokenCount = 0;
  for (const [token, count] of counts) {
    if (!Object.hasOwn(model.vocabulary, token)) continue;
    const weights = model.vocabulary[token];
    knownTokenCount += count;
    scores[0] += count * weights[0];
    scores[1] += count * weights[1];
    contributions.push({token, weight: count * (weights[1] - weights[0])});
  }
  const delta = scores[1] - scores[0];
  const exponential = Math.exp(delta >= 0 ? -delta : delta);
  const score = delta >= 0 ? 1 / (1 + exponential) : exponential / (1 + exponential);
  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
  return {score, topTokens: contributions.slice(0, 8), knownTokenCount, totalTokenCount: tokens.length};
}
