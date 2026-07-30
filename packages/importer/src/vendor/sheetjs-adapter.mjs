// @ts-nocheck -- owner: Import; reason: vendored SheetJS has no compatible declarations; remove when SheetJS is replaced or typed.
import * as sheetjs from "../../vendor/xlsx/xlsx.mjs";
import * as cptable from "../../vendor/xlsx/dist/cpexcel.full.mjs";

sheetjs.set_cptable(cptable);

/** @type {any} */
export const XLSX = sheetjs;
