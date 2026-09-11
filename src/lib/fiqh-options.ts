export type Mode = "fatwa" | "faraid" | "zakat";
export type School = "general" | "shafii" | "hanafi" | "maliki" | "hanbali";

export const MODES: { value: Mode; label: string; arabic: string; blurb: string }[] = [
  {
    value: "fatwa",
    label: "Fatwa",
    arabic: "الفتوى",
    blurb: "Rulings on worship, transactions and daily life, from the four Sunni schools.",
  },
  {
    value: "faraid",
    label: "Faraid",
    arabic: "الفرائض",
    blurb: "Inheritance law with the full share calculation for every heir.",
  },
  {
    value: "zakat",
    label: "Zakat",
    arabic: "الزكاة",
    blurb: "Zakat of wealth and zakat of the body, with nisab checks and amounts.",
  },
];

export const SCHOOLS: { value: School; label: string; arabic: string }[] = [
  { value: "general", label: "General (all four)", arabic: "عام" },
  { value: "shafii", label: "Shafi'i", arabic: "الشافعي" },
  { value: "hanafi", label: "Hanafi", arabic: "الحنفي" },
  { value: "maliki", label: "Maliki", arabic: "المالكي" },
  { value: "hanbali", label: "Hanbali", arabic: "الحنبلي" },
];

export const TOPICS: { value: string; label: string }[] = [
  { value: "general", label: "General / all topics" },
  { value: "fatwa", label: "Fatwa" },
  { value: "faraid", label: "Faraid (inheritance)" },
  { value: "zakat", label: "Zakat" },
];

export const SUGGESTIONS: Record<Mode, string[]> = {
  fatwa: [
    "Is it valid to combine Maghrib and Isha while travelling?",
    "What is the ruling on selling a debt for cash?",
    "Does touching one's wife break wudu?",
  ],
  faraid: [
    "A man died leaving a wife, 2 sons, 1 daughter and his mother. The estate is 240000.",
    "A woman died leaving her husband, her father and two full sisters.",
    "Explain how 'awl works with an example.",
  ],
  zakat: [
    "I have 12000 in cash, 90 grams of gold and 3000 of debt. How much zakat do I owe?",
    "How much zakat al-fitr for a family of six?",
    "Is zakat due on money saved for a house?",
  ],
};

export function modeLabel(mode: string): string {
  return MODES.find((m) => m.value === mode)?.label ?? "Fatwa";
}

export function schoolLabel(school: string): string {
  return SCHOOLS.find((s) => s.value === school)?.label ?? "General";
}
