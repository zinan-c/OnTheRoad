/*! cpexcel.mjs (C) 2013-present SheetJS -- http://sheetjs.com */
export const version: "1.15.0";
export const cptable: typeof cptable;
export namespace utils {
    export { decode };
    export { encode };
    export { hascp };
    export { magic };
    export { cache };
}
declare function decode(cp: any, data: any): any;
declare function encode(cp: any, data: any, ofmt: any): any;
declare function hascp(cp: any): boolean;
declare var magic: {
    "1200": string;
    "1201": string;
    "12000": string;
    "12001": string;
    "16969": string;
    "20127": string;
    "65000": string;
    "65001": string;
};
declare namespace cache {
    export { encache };
    export { decache };
    export { sbcs_cache as sbcs };
    export { dbcs_cache as dbcs };
}
declare function encache(): void;
declare function decache(): void;
declare var sbcs_cache: number[];
declare var dbcs_cache: number[];
export {};
