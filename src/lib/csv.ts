import { parse } from "csv-parse/sync";

import type { CatalogRow, CatalogWarning } from "@/types";

const REQUIRED_HEADERS = [
  "SKU",
  "Product Name",
  "Category",
  "Color / Finish",
  "Material",
  "Price",
  "Photo",
  "Shot Idea",
  "Notes",
] as const;

type RawCatalogRecord = Record<(typeof REQUIRED_HEADERS)[number], string>;

const normalizeOptional = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const parsePriceCents = (value: string): number => {
  const normalized = value.trim().replace("$", "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Unsupported price format: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const fractionPadded = `${fraction}00`.slice(0, 2);
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(fractionPadded, 10);
};

export const parseCatalogCsv = (contents: string): CatalogRow[] => {
  const records = parse(contents, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawCatalogRecord[];

  if (records.length === 0) {
    throw new Error("CSV is empty");
  }

  const actualHeaders = Object.keys(records[0]);
  for (const header of REQUIRED_HEADERS) {
    if (!actualHeaders.includes(header)) {
      throw new Error(`Missing required CSV header: ${header}`);
    }
  }

  return records.map((record) => ({
    sku: record["SKU"].trim(),
    productName: record["Product Name"].trim(),
    category: record["Category"].trim(),
    colorOrFinish: record["Color / Finish"].trim(),
    material: record["Material"].trim(),
    priceCents: parsePriceCents(record["Price"]),
    photoUrl: record["Photo"].trim(),
    shotIdea: normalizeOptional(record["Shot Idea"]),
    notes: normalizeOptional(record["Notes"]),
  }));
};

export const collectCatalogWarnings = (rows: CatalogRow[]): CatalogWarning[] => {
  const warnings: CatalogWarning[] = [];

  for (const row of rows) {
    const notes = row.notes?.toLowerCase() ?? "";

    if (notes.includes("discontinued")) {
      warnings.push({ sku: row.sku, message: "Notes mention possible discontinuation." });
    }
    if (notes.includes("underexposed")) {
      warnings.push({ sku: row.sku, message: "Source photo may be underexposed." });
    }
    if (notes.includes("shiny")) {
      warnings.push({ sku: row.sku, message: "Notes mention prior reflectivity issues." });
    }
    if (notes.includes("photographs badly") || notes.includes("careful")) {
      warnings.push({ sku: row.sku, message: "Notes flag the product as tricky to photograph." });
    }
  }

  return warnings;
};
