export type Tone = 'good' | 'mixed' | 'bad';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatPrice(value: number): string {
  return value <= 0 ? 'Free' : usd.format(value);
}

export function metacriticTone(score: number): Tone {
  return score >= 75 ? 'good' : score >= 50 ? 'mixed' : 'bad';
}

export function steamRatingTone(percent: number): Tone {
  return percent >= 70 ? 'good' : percent >= 40 ? 'mixed' : 'bad';
}

export function dealUrl(dealId: string): string {
  return `https://www.cheapshark.com/redirect?dealID=${dealId}`;
}

export function compactCount(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
