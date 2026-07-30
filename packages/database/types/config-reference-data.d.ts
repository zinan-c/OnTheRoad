declare module "@on-the-road/config/reference-data" {
  export const currencies: readonly {
    code: string;
    label: string;
    aliases: readonly string[];
  }[];
  export const costCategories: readonly {
    code: string;
    label: string;
    icon: string;
    color: string;
  }[];
  export const transportModes: readonly {
    code: string;
    label: string;
    aliases: readonly string[];
    icon: string;
    color: string;
    lineStyle: "solid" | "dashed" | "dotted";
  }[];
}
