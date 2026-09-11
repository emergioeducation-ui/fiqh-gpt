/** Zakat calculation engine — pure functions, no I/O. */

export type ZakatSettings = {
  gold_price_per_gram: number;
  silver_price_per_gram: number;
  gold_nisab_grams: number;
  silver_nisab_grams: number;
  fitr_saa_kg: number;
  fitr_food_price_per_kg: number;
  currency?: string;
};

export const DEFAULT_ZAKAT_SETTINGS: ZakatSettings = {
  gold_price_per_gram: 75,
  silver_price_per_gram: 0.9,
  gold_nisab_grams: 85,
  silver_nisab_grams: 595,
  fitr_saa_kg: 2.5,
  fitr_food_price_per_kg: 2,
  currency: "USD",
};

export type WealthInput = {
  cash?: number;
  bankBalance?: number;
  goldGrams?: number;
  silverGrams?: number;
  tradeGoods?: number;
  receivables?: number;
  investments?: number;
  debts?: number;
  nisabBasis?: "silver" | "gold";
};

export type WealthResult = {
  lines: { label: string; value: number }[];
  goldValue: number;
  silverValue: number;
  grossAssets: number;
  debts: number;
  netWealth: number;
  nisabBasis: "silver" | "gold";
  nisabValue: number;
  aboveNisab: boolean;
  rate: number;
  zakatDue: number;
  currency: string;
};

export function calculateWealthZakat(
  input: WealthInput,
  settings: ZakatSettings = DEFAULT_ZAKAT_SETTINGS,
): WealthResult {
  const num = (v?: number) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  const goldValue = num(input.goldGrams) * settings.gold_price_per_gram;
  const silverValue = num(input.silverGrams) * settings.silver_price_per_gram;
  const lines = [
    { label: "Cash in hand", value: num(input.cash) },
    { label: "Bank balances", value: num(input.bankBalance) },
    { label: `Gold (${num(input.goldGrams)} g)`, value: goldValue },
    { label: `Silver (${num(input.silverGrams)} g)`, value: silverValue },
    { label: "Trade goods / stock", value: num(input.tradeGoods) },
    { label: "Reliable receivables", value: num(input.receivables) },
    { label: "Investments", value: num(input.investments) },
  ].filter((l) => l.value > 0);

  const grossAssets = lines.reduce((a, l) => a + l.value, 0);
  const debts = num(input.debts);
  const netWealth = Math.max(0, grossAssets - debts);
  const nisabBasis = input.nisabBasis ?? "silver";
  const nisabValue =
    nisabBasis === "gold"
      ? settings.gold_nisab_grams * settings.gold_price_per_gram
      : settings.silver_nisab_grams * settings.silver_price_per_gram;
  const aboveNisab = netWealth >= nisabValue;
  const rate = 0.025;

  return {
    lines,
    goldValue,
    silverValue,
    grossAssets,
    debts,
    netWealth,
    nisabBasis,
    nisabValue,
    aboveNisab,
    rate,
    zakatDue: aboveNisab ? netWealth * rate : 0,
    currency: settings.currency ?? "USD",
  };
}

export type FitrInput = { people?: number; payInFood?: boolean };
export type FitrResult = {
  people: number;
  saaPerPerson: number;
  totalKg: number;
  pricePerKg: number;
  totalMoney: number;
  currency: string;
};

export function calculateFitrZakat(
  input: FitrInput,
  settings: ZakatSettings = DEFAULT_ZAKAT_SETTINGS,
): FitrResult {
  const people = Math.max(1, Math.floor(Number(input.people) || 1));
  const totalKg = people * settings.fitr_saa_kg;
  return {
    people,
    saaPerPerson: settings.fitr_saa_kg,
    totalKg,
    pricePerKg: settings.fitr_food_price_per_kg,
    totalMoney: totalKg * settings.fitr_food_price_per_kg,
    currency: settings.currency ?? "USD",
  };
}

/** Zakat on crops: 5% when irrigated by effort/cost, 10% when rain-fed. */
export function calculateCropZakat(quantityKg: number, irrigatedByCost: boolean) {
  const nisabKg = 653; // five awsuq ≈ 653 kg of staple grain
  const q = Math.max(0, Number(quantityKg) || 0);
  const rate = irrigatedByCost ? 0.05 : 0.1;
  return { quantityKg: q, nisabKg, aboveNisab: q >= nisabKg, rate, dueKg: q >= nisabKg ? q * rate : 0 };
}

const CAMEL_TABLE: [number, number, string][] = [
  [5, 9, "1 bint makhad (one-year-old she-camel) or 1 sheep per 5 camels"],
  [10, 14, "2 sheep"],
  [15, 19, "3 sheep"],
  [20, 24, "4 sheep"],
  [25, 35, "1 bint makhad (she-camel in her second year)"],
  [36, 45, "1 bint labun (she-camel in her third year)"],
  [46, 60, "1 hiqqah (she-camel in her fourth year)"],
  [61, 75, "1 jaz'ah (she-camel in her fifth year)"],
  [76, 90, "2 bint labun"],
  [91, 120, "2 hiqqah"],
];
const COW_TABLE: [number, number, string][] = [
  [30, 39, "1 tabi' (one-year-old calf)"],
  [40, 59, "1 musinnah (two-year-old cow)"],
  [60, 69, "2 tabi'"],
  [70, 79, "1 musinnah + 1 tabi'"],
  [80, 89, "2 musinnah"],
];
const SHEEP_TABLE: [number, number, string][] = [
  [40, 120, "1 sheep"],
  [121, 200, "2 sheep"],
  [201, 399, "3 sheep"],
  [400, 499, "4 sheep"],
];

export function calculateLivestockZakat(kind: "camel" | "cattle" | "sheep", count: number) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const table = kind === "camel" ? CAMEL_TABLE : kind === "cattle" ? COW_TABLE : SHEEP_TABLE;
  const minimum = kind === "camel" ? 5 : kind === "cattle" ? 30 : 40;
  if (n < minimum) {
    return { kind, count: n, aboveNisab: false, due: `Below the nisab of ${minimum} ${kind}` };
  }
  const row = table.find(([lo, hi]) => n >= lo && n <= hi);
  if (row) return { kind, count: n, aboveNisab: true, due: row[2] };
  if (kind === "camel")
    return {
      kind,
      count: n,
      aboveNisab: true,
      due: "Above 120: 1 bint labun for every 40 and 1 hiqqah for every 50",
    };
  if (kind === "cattle")
    return {
      kind,
      count: n,
      aboveNisab: true,
      due: "Above 89: 1 tabi' for every 30 and 1 musinnah for every 40",
    };
  return { kind, count: n, aboveNisab: true, due: "Above 499: 1 sheep for every additional 100" };
}

export function zakatSummary(
  wealth: WealthInput | null,
  fitr: FitrInput | null,
  settings: ZakatSettings,
): string {
  const out: string[] = [];
  if (wealth) {
    const r = calculateWealthZakat(wealth, settings);
    out.push(
      `Zakat al-mal: gross assets ${r.grossAssets.toFixed(2)} ${r.currency}, debts ${r.debts.toFixed(2)}, net ${r.netWealth.toFixed(2)}. Nisab (${r.nisabBasis}) = ${r.nisabValue.toFixed(2)} ${r.currency}. ${
        r.aboveNisab ? `Above nisab, so 2.5% = ${r.zakatDue.toFixed(2)} ${r.currency} is due.` : "Below nisab, so no zakat is due on wealth."
      }`,
    );
  }
  if (fitr) {
    const f = calculateFitrZakat(fitr, settings);
    out.push(
      `Zakat al-fitr: ${f.people} person(s) x ${f.saaPerPerson} kg = ${f.totalKg} kg of staple food, approximately ${f.totalMoney.toFixed(2)} ${f.currency} in value.`,
    );
  }
  return out.join("\n");
}
