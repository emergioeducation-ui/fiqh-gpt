/**
 * Faraid (Islamic inheritance) calculation engine.
 * Pure functions — no I/O — so results are deterministic and testable.
 *
 * Implements the classical Sunni system: fixed shares (furud muqaddara),
 * blocking (hajb), residuary heirs ('asaba), increase of the denominator
 * ('awl) and return of the surplus (radd).
 */

export type Fraction = { n: number; d: number };

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const lcm = (a: number, b: number): number => Math.abs(a * b) / gcd(a, b);

export const frac = (n: number, d = 1): Fraction => {
  if (d === 0) throw new Error("Zero denominator");
  const sign = d < 0 ? -1 : 1;
  const g = gcd(n, d) || 1;
  return { n: (sign * n) / g, d: (sign * d) / g };
};
export const addF = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const subF = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mulF = (a: Fraction, b: Fraction): Fraction => frac(a.n * b.n, a.d * b.d);
export const cmpF = (a: Fraction, b: Fraction): number => a.n * b.d - b.n * a.d;
export const toNumber = (f: Fraction): number => f.n / f.d;
export const formatF = (f: Fraction): string => (f.d === 1 ? `${f.n}` : `${f.n}/${f.d}`);

export type HeirInput = {
  husband?: number; // 0 or 1
  wives?: number;
  father?: number; // 0 or 1
  mother?: number; // 0 or 1
  paternalGrandfather?: number; // 0 or 1
  grandmothers?: number; // maternal and/or paternal grandmothers
  sons?: number;
  daughters?: number;
  grandsons?: number; // son's sons
  granddaughters?: number; // son's daughters
  fullBrothers?: number;
  fullSisters?: number;
  paternalBrothers?: number; // same father only
  paternalSisters?: number;
  maternalSiblings?: number; // same mother only (male or female, equal shares)
};

export type HeirResult = {
  key: string;
  label: string;
  labelArabic: string;
  count: number;
  basis: "fard" | "asaba" | "fard+asaba" | "radd" | "blocked";
  share: Fraction; // total share of the estate for this group
  perHead?: Fraction | undefined;
  reason: string;
};

export type FaraidResult = {
  heirs: HeirResult[];
  blocked: HeirResult[];
  baseDenominator: number;
  awl: boolean;
  radd: boolean;
  residue: Fraction;
  notes: string[];
  totalDistributed: Fraction;
};

const LABELS: Record<string, [string, string]> = {
  husband: ["Husband", "الزوج"],
  wives: ["Wife/Wives", "الزوجة/الزوجات"],
  father: ["Father", "الأب"],
  mother: ["Mother", "الأم"],
  paternalGrandfather: ["Paternal grandfather", "الجد"],
  grandmothers: ["Grandmother(s)", "الجدة/الجدات"],
  sons: ["Son(s)", "الابن/الأبناء"],
  daughters: ["Daughter(s)", "البنت/البنات"],
  grandsons: ["Son's son(s)", "ابن الابن"],
  granddaughters: ["Son's daughter(s)", "بنت الابن"],
  fullBrothers: ["Full brother(s)", "الأخ الشقيق"],
  fullSisters: ["Full sister(s)", "الأخت الشقيقة"],
  paternalBrothers: ["Paternal brother(s)", "الأخ لأب"],
  paternalSisters: ["Paternal sister(s)", "الأخت لأب"],
  maternalSiblings: ["Maternal sibling(s)", "الأخ/الأخت لأم"],
};

export function calculateFaraid(inputRaw: HeirInput): FaraidResult {
  const i: Required<HeirInput> = {
    husband: 0,
    wives: 0,
    father: 0,
    mother: 0,
    paternalGrandfather: 0,
    grandmothers: 0,
    sons: 0,
    daughters: 0,
    grandsons: 0,
    granddaughters: 0,
    fullBrothers: 0,
    fullSisters: 0,
    paternalBrothers: 0,
    paternalSisters: 0,
    maternalSiblings: 0,
    ...Object.fromEntries(
      Object.entries(inputRaw).map(([k, v]) => [k, Math.max(0, Math.floor(Number(v) || 0))]),
    ),
  };
  if (i.husband > 1) i.husband = 1;
  if (i.father > 1) i.father = 1;
  if (i.mother > 1) i.mother = 1;
  if (i.paternalGrandfather > 1) i.paternalGrandfather = 1;

  const notes: string[] = [];
  const heirs: HeirResult[] = [];
  const blocked: HeirResult[] = [];

  const push = (
    key: string,
    count: number,
    basis: HeirResult["basis"],
    share: Fraction,
    reason: string,
  ) => {
    const [label, labelArabic] = LABELS[key] ?? [key, key];
    const target = basis === "blocked" ? blocked : heirs;
    target.push({
      key,
      label,
      labelArabic,
      count,
      basis,
      share,
      perHead: count > 0 && basis !== "blocked" ? frac(share.n, share.d * count) : undefined,
      reason,
    });
  };

  const maleDescendant = i.sons > 0 || i.grandsons > 0;
  const anyDescendant = maleDescendant || i.daughters > 0 || i.granddaughters > 0;
  const siblingCount =
    i.fullBrothers + i.fullSisters + i.paternalBrothers + i.paternalSisters + i.maternalSiblings;
  const hasFatherLine = i.father > 0 || i.paternalGrandfather > 0;

  // ---- spouse -----------------------------------------------------------
  if (i.husband > 0) {
    const s = anyDescendant ? frac(1, 4) : frac(1, 2);
    push("husband", 1, "fard", s, anyDescendant ? "1/4 — a child of the deceased exists" : "1/2 — no descendant exists");
  }
  if (i.wives > 0) {
    const s = anyDescendant ? frac(1, 8) : frac(1, 4);
    push("wives", i.wives, "fard", s, anyDescendant ? "1/8 shared — a child exists" : "1/4 shared — no descendant exists");
  }

  // ---- mother / grandmothers -------------------------------------------
  const umariyyah =
    i.mother > 0 && i.father > 0 && !anyDescendant && siblingCount < 2 && (i.husband > 0 || i.wives > 0);
  let motherShare: Fraction | null = null;
  if (i.mother > 0) {
    if (anyDescendant || siblingCount >= 2) {
      motherShare = frac(1, 6);
      push("mother", 1, "fard", motherShare, anyDescendant ? "1/6 — a descendant exists" : "1/6 — two or more siblings exist");
    } else if (!umariyyah) {
      motherShare = frac(1, 3);
      push("mother", 1, "fard", motherShare, "1/3 — no descendant and fewer than two siblings");
    }
    // 'Umariyyatan case handled after the spouse's share is known (below).
  }
  if (i.grandmothers > 0) {
    if (i.mother > 0) {
      push("grandmothers", i.grandmothers, "blocked", frac(0), "Blocked (hajb) by the mother");
    } else {
      push("grandmothers", i.grandmothers, "fard", frac(1, 6), "1/6 shared between the eligible grandmothers");
    }
  }

  // ---- maternal siblings ------------------------------------------------
  if (i.maternalSiblings > 0) {
    if (anyDescendant || hasFatherLine) {
      push("maternalSiblings", i.maternalSiblings, "blocked", frac(0), "Blocked by a descendant or by the father/grandfather");
    } else {
      const s = i.maternalSiblings === 1 ? frac(1, 6) : frac(1, 3);
      push("maternalSiblings", i.maternalSiblings, "fard", s, i.maternalSiblings === 1 ? "1/6 — a single maternal sibling" : "1/3 shared equally — two or more maternal siblings");
    }
  }

  // ---- father / paternal grandfather ----------------------------------
  const fatherKey = i.father > 0 ? "father" : i.paternalGrandfather > 0 ? "paternalGrandfather" : null;
  if (i.father > 0 && i.paternalGrandfather > 0) {
    push("paternalGrandfather", 1, "blocked", frac(0), "Blocked by the father");
  }
  let fatherFard: Fraction | null = null;
  if (fatherKey) {
    if (maleDescendant) {
      fatherFard = frac(1, 6);
      push(fatherKey, 1, "fard", fatherFard, "1/6 — a male descendant exists, so no residue passes to him");
    } else if (anyDescendant) {
      fatherFard = frac(1, 6);
      push(fatherKey, 1, "fard+asaba", fatherFard, "1/6 as a fixed share plus any remaining residue (only female descendants exist)");
    } else {
      push(fatherKey, 1, "asaba", frac(0), "Takes the whole residue as the nearest male relative ('asaba)");
    }
  }

  // ---- female descendants ---------------------------------------------
  let daughtersFard: Fraction | null = null;
  if (i.daughters > 0 && i.sons === 0) {
    daughtersFard = i.daughters === 1 ? frac(1, 2) : frac(2, 3);
    push("daughters", i.daughters, "fard", daughtersFard, i.daughters === 1 ? "1/2 — one daughter, no son" : "2/3 shared — two or more daughters, no son");
  }
  if (i.granddaughters > 0) {
    if (i.sons > 0) {
      push("granddaughters", i.granddaughters, "blocked", frac(0), "Blocked by the son");
    } else if (i.grandsons > 0) {
      // becomes residuary with the grandsons (2:1) — handled in the residue step
    } else if (i.daughters >= 2) {
      push("granddaughters", i.granddaughters, "blocked", frac(0), "Blocked — the 2/3 of the daughters is already complete");
    } else if (i.daughters === 1) {
      push("granddaughters", i.granddaughters, "fard", frac(1, 6), "1/6 completing the two-thirds alongside the single daughter");
    } else {
      const s = i.granddaughters === 1 ? frac(1, 2) : frac(2, 3);
      push("granddaughters", i.granddaughters, "fard", s, i.granddaughters === 1 ? "1/2 — one son's daughter and no nearer descendant" : "2/3 shared — two or more son's daughters");
    }
  }

  // ---- full and paternal siblings -------------------------------------
  const siblingsBlockedByLine = maleDescendant || i.father > 0;
  const fullSistersAsAsaba =
    !siblingsBlockedByLine && i.fullBrothers === 0 && i.fullSisters > 0 && (i.daughters > 0 || i.granddaughters > 0);

  if (i.fullBrothers > 0) {
    if (siblingsBlockedByLine) {
      push("fullBrothers", i.fullBrothers, "blocked", frac(0), "Blocked by a male descendant or by the father");
    }
  }
  if (i.fullSisters > 0) {
    if (siblingsBlockedByLine) {
      push("fullSisters", i.fullSisters, "blocked", frac(0), "Blocked by a male descendant or by the father");
    } else if (i.fullBrothers > 0 || fullSistersAsAsaba) {
      // residuary — handled in the residue step
    } else {
      const s = i.fullSisters === 1 ? frac(1, 2) : frac(2, 3);
      push("fullSisters", i.fullSisters, "fard", s, i.fullSisters === 1 ? "1/2 — one full sister with no descendant or father" : "2/3 shared — two or more full sisters");
    }
  }

  const paternalBlocked =
    siblingsBlockedByLine || i.fullBrothers > 0 || i.fullSisters >= 2 || fullSistersAsAsaba;
  const paternalSistersAsAsaba =
    !paternalBlocked && i.paternalBrothers === 0 && i.paternalSisters > 0 && (i.daughters > 0 || i.granddaughters > 0);

  if (i.paternalBrothers > 0 && paternalBlocked) {
    push("paternalBrothers", i.paternalBrothers, "blocked", frac(0), "Blocked by a nearer heir (male descendant, father, or full siblings)");
  }
  if (i.paternalSisters > 0) {
    if (paternalBlocked) {
      push("paternalSisters", i.paternalSisters, "blocked", frac(0), "Blocked by a nearer heir (male descendant, father, or full siblings)");
    } else if (i.paternalBrothers > 0 || paternalSistersAsAsaba) {
      // residuary — handled below
    } else if (i.fullSisters === 1) {
      push("paternalSisters", i.paternalSisters, "fard", frac(1, 6), "1/6 completing the two-thirds alongside the single full sister");
    } else {
      const s = i.paternalSisters === 1 ? frac(1, 2) : frac(2, 3);
      push("paternalSisters", i.paternalSisters, "fard", s, i.paternalSisters === 1 ? "1/2 — one paternal sister" : "2/3 shared — two or more paternal sisters");
    }
  }

  // ---- 'Umariyyatan: mother takes 1/3 of the remainder after the spouse
  if (umariyyah) {
    const spouse = heirs.find((h) => h.key === "husband" || h.key === "wives");
    const remainder = subF(frac(1), spouse ? spouse.share : frac(0));
    motherShare = mulF(remainder, frac(1, 3));
    push(
      "mother",
      1,
      "fard",
      motherShare,
      "One third of what remains after the spouse's share (al-mas'alah al-'Umariyyah)",
    );
  }

  // ---- sum the fixed shares -------------------------------------------
  let fixedTotal = heirs.reduce((acc, h) => addF(acc, h.share), frac(0));
  let awl = false;
  if (cmpF(fixedTotal, frac(1)) > 0) {
    // 'Awl — every fixed share is reduced proportionally by raising the base.
    awl = true;
    const factor = frac(fixedTotal.d, fixedTotal.n);
    for (const h of heirs) {
      h.share = mulF(h.share, factor);
      h.perHead = h.count > 0 ? frac(h.share.n, h.share.d * h.count) : undefined;
    }
    notes.push(
      `The fixed shares add up to more than the whole estate (${formatF(fixedTotal)}), so the base is increased ('awl) and every fixed share is reduced proportionally.`,
    );
    fixedTotal = frac(1);
  }

  let residue = subF(frac(1), fixedTotal);
  const residueAtStart = residue;

  // ---- residuary heirs ('asaba) in order of priority -------------------
  type AsabaUnit = { key: string; count: number; weight: number };
  let asabaGroup: AsabaUnit[] | null = null;

  if (i.sons > 0 || (i.daughters > 0 && i.sons > 0)) {
    asabaGroup = [
      { key: "sons", count: i.sons, weight: 2 },
      ...(i.daughters > 0 ? [{ key: "daughters", count: i.daughters, weight: 1 }] : []),
    ];
  } else if (i.grandsons > 0) {
    asabaGroup = [
      { key: "grandsons", count: i.grandsons, weight: 2 },
      ...(i.granddaughters > 0 ? [{ key: "granddaughters", count: i.granddaughters, weight: 1 }] : []),
    ];
  } else if (fatherKey && !maleDescendant) {
    asabaGroup = [{ key: fatherKey, count: 1, weight: 1 }];
  } else if (!siblingsBlockedByLine && (i.fullBrothers > 0 || fullSistersAsAsaba)) {
    asabaGroup = [
      ...(i.fullBrothers > 0 ? [{ key: "fullBrothers", count: i.fullBrothers, weight: 2 }] : []),
      ...(i.fullSisters > 0 ? [{ key: "fullSisters", count: i.fullSisters, weight: 1 }] : []),
    ];
  } else if (!paternalBlocked && (i.paternalBrothers > 0 || paternalSistersAsAsaba)) {
    asabaGroup = [
      ...(i.paternalBrothers > 0 ? [{ key: "paternalBrothers", count: i.paternalBrothers, weight: 2 }] : []),
      ...(i.paternalSisters > 0 ? [{ key: "paternalSisters", count: i.paternalSisters, weight: 1 }] : []),
    ];
  }

  if (asabaGroup && cmpF(residue, frac(0)) > 0) {
    const totalWeight = asabaGroup.reduce((acc, u) => acc + u.count * u.weight, 0);
    for (const unit of asabaGroup) {
      const portion = mulF(residue, frac(unit.count * unit.weight, totalWeight));
      const existing = heirs.find((h) => h.key === unit.key);
      if (existing) {
        existing.share = addF(existing.share, portion);
        existing.basis = existing.basis === "fard" ? "fard+asaba" : existing.basis;
        existing.perHead = frac(existing.share.n, existing.share.d * existing.count);
        existing.reason += ` — plus a share of the residue (${formatF(portion)} of the estate)`;
      } else {
        push(
          unit.key,
          unit.count,
          "asaba",
          portion,
          asabaGroup.length > 1
            ? "Residuary heir — the residue is divided so that a male takes twice the share of a female"
            : "Residuary heir — takes the remaining estate",
        );
      }
    }
    residue = frac(0);
  }

  // ---- radd — surplus returned to the fixed sharers --------------------
  let radd = false;
  if (cmpF(residue, frac(0)) > 0) {
    const eligible = heirs.filter((h) => h.key !== "husband" && h.key !== "wives" && h.share.n > 0);
    if (eligible.length > 0) {
      radd = true;
      const base = eligible.reduce((acc, h) => addF(acc, h.share), frac(0));
      for (const h of eligible) {
        const extra = mulF(residue, frac(h.share.n * base.d, h.share.d * base.n));
        h.share = addF(h.share, extra);
        h.perHead = h.count > 0 ? frac(h.share.n, h.share.d * h.count) : undefined;
        h.basis = "radd";
      }
      notes.push(
        `No residuary heir ('asaba) exists, so the surplus of ${formatF(residueAtStart)} is returned (radd) to the fixed sharers other than the spouse, in proportion to their shares.`,
      );
      residue = frac(0);
    } else {
      notes.push(
        `A surplus of ${formatF(residue)} remains with no eligible heir. According to the majority it goes to the distant kindred (dhawu al-arham), and otherwise to the public treasury.`,
      );
    }
  }

  const totalDistributed = heirs.reduce((acc, h) => addF(acc, h.share), frac(0));
  const baseDenominator = heirs.reduce((acc, h) => lcm(acc, h.share.d), 1);
  if (awl) notes.push(`Base of the problem (asl al-mas'alah) after correction: ${baseDenominator}.`);

  return { heirs, blocked, baseDenominator, awl, radd, residue, notes, totalDistributed };
}

export function distributeEstate(result: FaraidResult, estateValue: number) {
  return result.heirs.map((h) => ({
    ...h,
    amount: toNumber(h.share) * estateValue,
    amountPerHead: h.count > 0 ? (toNumber(h.share) * estateValue) / h.count : 0,
  }));
}

/** Compact plain-text summary used as grounding context for the model. */
export function faraidSummary(input: HeirInput, estateValue?: number): string {
  const r = calculateFaraid(input);
  const lines: string[] = [];
  lines.push(`Base (asl al-mas'alah): ${r.baseDenominator}${r.awl ? " (after 'awl)" : ""}`);
  for (const h of r.heirs) {
    const amount =
      estateValue && estateValue > 0 ? ` = ${(toNumber(h.share) * estateValue).toFixed(2)}` : "";
    lines.push(
      `${h.label} (${h.labelArabic}) x${h.count}: ${formatF(h.share)}${amount} [${h.basis}] — ${h.reason}`,
    );
  }
  for (const b of r.blocked) lines.push(`${b.label} (${b.labelArabic}) x${b.count}: excluded — ${b.reason}`);
  for (const n of r.notes) lines.push(`Note: ${n}`);
  lines.push(`Total distributed: ${formatF(r.totalDistributed)}`);
  return lines.join("\n");
}
