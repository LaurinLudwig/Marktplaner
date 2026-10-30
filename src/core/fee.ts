/**
 * Standgeld (#5, spec.md §3 „Standgeld“): netto aus den Frontmetern (Breite) und dem Preis je Frontmeter des Projekts
 * oder dem Sonderpreis der Kategorie (eigener Preis je Frontmeter oder Pauschale je Stand). Brutto = netto plus
 * Mehrwertsteuer, je Stand auf Cent gerundet; Summen addieren die gerundeten Beträge der Stände in ganzen Cent.
 */
import type { Category, Id, PricingSettings, Stand } from './model/types';

export interface Fee {
  /** Netto in Euro, auf Cent gerundet. */
  net: number;
  /** Brutto in Euro, auf Cent gerundet. */
  gross: number;
  /** Woher der Preis kommt: Projektpreis, Sonderpreis je Frontmeter oder Pauschale der Kategorie. */
  source: 'project' | 'perMeter' | 'flat';
  /** Berechnete Frontmeter (bei „angefangene Meter voll“ aufgerundet); bei Pauschalen die Breite. */
  meters: number;
  /** Preis je Frontmeter bzw. Pauschale (netto). */
  rate: number;
}

const cents = (euro: number) => Math.round(euro * 100);

/** Frontmeter für die Rechnung: Breite auf 0,01 m, bei `roundUpMeters` angefangene Meter voll (4,30 → 5, 4,00 → 4). */
export function billedMeters(w: number, roundUpMeters: boolean): number {
  const m = Math.round(w * 100) / 100;
  return roundUpMeters ? Math.ceil(m - 1e-9) : m;
}

export const grossOf = (net: number, vatRate: number) => cents(net * (1 + vatRate / 100)) / 100;

/** Standgeld eines Stands; null, wenn weder die Kategorie noch das Projekt einen Preis hat. */
export function standFee(stand: Pick<Stand, 'w'>, category: Pick<Category, 'price'> | undefined, pricing: PricingSettings): Fee | null {
  const special = category?.price ?? null;
  const meters = billedMeters(stand.w, pricing.roundUpMeters);
  let net: number;
  let source: Fee['source'];
  let rate: number;
  if (special?.kind === 'flat') {
    [net, source, rate] = [special.amount, 'flat', special.amount];
  } else if (special?.kind === 'perMeter') {
    [net, source, rate] = [cents(meters * special.amount) / 100, 'perMeter', special.amount];
  } else if (pricing.perMeter !== null) {
    [net, source, rate] = [cents(meters * pricing.perMeter) / 100, 'project', pricing.perMeter];
  } else {
    return null;
  }
  return { net, gross: grossOf(net, pricing.vatRate), source, meters: source === 'flat' ? Math.round(stand.w * 100) / 100 : meters, rate };
}

/** Ob überhaupt ein Preis festgelegt ist (sonst blenden Tabelle, Kennzahlen und Seitenleiste das Standgeld aus). */
export const hasPricing = (pricing: PricingSettings, categories: readonly Pick<Category, 'price'>[]) =>
  pricing.perMeter !== null || categories.some((c) => c.price !== null);

export interface FeeSum {
  net: number;
  gross: number;
  /** Stände mit Standgeld (ohne Preis zählen sie nicht mit). */
  count: number;
}

export const NO_FEE_SUM: FeeSum = { net: 0, gross: 0, count: 0 };

/** Summe in ganzen Cent, damit keine Gleitkomma-Reste entstehen. */
export function sumFees(fees: Iterable<Fee | null>): FeeSum {
  let net = 0;
  let gross = 0;
  let count = 0;
  for (const f of fees) {
    if (!f) continue;
    net += cents(f.net);
    gross += cents(f.gross);
    count++;
  }
  return { net: net / 100, gross: gross / 100, count };
}

/** Standgeld aller Stände einer Liste, Kategorien über ihre ID (nicht mehr vorhandene zählen als „ohne“). */
export function feesOf(stands: readonly Pick<Stand, 'w' | 'categoryId'>[], categories: readonly Category[], pricing: PricingSettings): (Fee | null)[] {
  const byId = new Map<Id, Category>(categories.map((c) => [c.id, c]));
  return stands.map((s) => standFee(s, s.categoryId ? byId.get(s.categoryId) : undefined, pricing));
}

/** „1.234,50“: deutsches Format mit Tausenderpunkt und immer zwei Nachkommastellen (Spalten mit „(€)“ im Kopf). */
export const fmtMoney = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** „1.234,50 €“ */
export const fmtEuro = (n: number) => `${fmtMoney(n)} €`;
