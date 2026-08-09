export const editorGroups = [
  "time",
  "location",
  "transport",
  "hospitality",
  "cost",
  "notes",
] as const;

export type ItemKind =
  | "activity"
  | "attraction"
  | "dining"
  | "accommodation"
  | "transport"
  | "other";

export type EditorDraft = {
  target: string;
  description: string;
  timeKind: "clock" | "range" | "period" | "unscheduled";
  timePeriod: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  durationMinutes?: number;
  locationText: string;
  locationId: string;
  transportModeId: string;
  transportOrigin: string;
  transportDestination: string;
  diningName: string;
  mealType: string;
  hotelName: string;
  accommodationType: string;
  checkInDate: string;
  checkOutDate: string;
  reservationReference: string;
  contactName: string;
  contactPhone: string;
  costAmount: string;
  costCurrency: string;
  costCategory: string;
  notes: string;
};

export type EditorPayload = {
  contract: "b06-frozen-v1";
  tripId: string;
  tripDayId: string;
  kind: ItemKind;
  target: string;
  description?: string;
  schedule: {
    startTime?: string;
    endTime?: string;
    crossesMidnight: boolean;
    durationMinutes?: number;
  };
  location?: { text: string; locationId?: string };
  transport?: { modeId?: string; origin?: string; destination?: string };
  hospitality?: {
    dining?: { name: string; mealType?: string };
    accommodation?: {
      name: string;
      type?: string;
      checkInDate?: string;
      checkOutDate?: string;
    };
    reservationReference?: string;
    contactName?: string;
    contactPhone?: string;
  };
  cost?: { amount: string; currency: string; category?: string };
  notes?: string;
};

const emptyDraft = (): EditorDraft => ({
  target: "",
  description: "",
  timeKind: "unscheduled",
  timePeriod: "",
  startTime: "",
  endTime: "",
  crossesMidnight: false,
  locationText: "",
  locationId: "",
  transportModeId: "",
  transportOrigin: "",
  transportDestination: "",
  diningName: "",
  mealType: "",
  hotelName: "",
  accommodationType: "",
  checkInDate: "",
  checkOutDate: "",
  reservationReference: "",
  contactName: "",
  contactPhone: "",
  costAmount: "",
  costCurrency: "",
  costCategory: "",
  notes: "",
});

type EditorOptions = {
  tripId: string;
  dayId: string;
  kind: ItemKind;
  initial?: Partial<EditorDraft>;
  itemId?: string;
  version?: number;
};

export class ItemEditor {
  readonly tripId: string;
  readonly dayId: string;
  readonly kind: ItemKind;
  readonly itemId: string | undefined;
  readonly version: number | undefined;
  readonly draft: EditorDraft;

  constructor(options: EditorOptions) {
    this.tripId = options.tripId;
    this.dayId = options.dayId;
    this.kind = options.kind;
    this.itemId = options.itemId;
    this.version = options.version;
    this.draft = { ...emptyDraft(), ...options.initial };
  }

  update(input: Partial<EditorDraft>): void {
    Object.assign(this.draft, input);
  }

  validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!this.draft.target.trim() && !this.draft.description.trim()) {
      errors.target = "事项名称或描述至少填写一项";
    }
    for (const field of ["startTime", "endTime"] as const) {
      const value = this.draft[field];
      if (value && !/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
        errors[field] = "时间必须使用 HH:mm";
      }
    }
    if (
      this.draft.startTime
      && this.draft.endTime
      && !this.draft.crossesMidnight
      && this.draft.endTime < this.draft.startTime
    ) {
      errors.endTime = "结束时间早于开始时间时必须标记跨午夜";
    }
    if (this.draft.timeKind === "clock" && !this.draft.startTime) {
      errors.startTime = "时刻事项必须填写开始时间";
    }
    if (
      this.draft.timeKind === "range"
      && (!this.draft.startTime || !this.draft.endTime)
    ) {
      errors.endTime = "时间范围必须填写开始和结束时间";
    }
    if (this.draft.timeKind === "period" && !this.draft.timePeriod) {
      errors.timePeriod = "时段事项必须选择时段";
    }
    if (
      this.draft.durationMinutes !== undefined
      && (!Number.isSafeInteger(this.draft.durationMinutes)
        || this.draft.durationMinutes < 0
        || this.draft.durationMinutes > 10_080)
    ) {
      errors.durationMinutes = "时长必须是 0 到 10080 分钟的整数";
    }
    if (this.kind === "dining" && !this.draft.diningName.trim()) {
      errors.diningName = "餐饮事项必须填写餐厅名称";
    }
    if (this.kind === "accommodation") {
      if (!this.draft.hotelName.trim()) {
        errors.hotelName = "住宿事项必须填写住宿名称";
      }
      if (
        this.draft.checkInDate
        && this.draft.checkOutDate
        && this.draft.checkOutDate < this.draft.checkInDate
      ) {
        errors.checkOutDate = "退房日期不得早于入住日期";
      }
    }
    if (this.kind === "transport" && !this.draft.transportModeId) {
      errors.transportModeId = "交通事项必须选择交通方式";
    }
    if (
      this.draft.costAmount
      && !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(this.draft.costAmount)
    ) {
      errors.costAmount = "金额必须是非负且最多两位小数";
    }
    if (this.draft.costAmount && !/^[A-Z]{3}$/u.test(this.draft.costCurrency)) {
      errors.costCurrency = "填写金额时必须选择三字母币种";
    }
    if (this.draft.target.length > 200) errors.target = "事项名称不得超过 200 字";
    if (this.draft.description.length > 5_000) {
      errors.description = "描述不得超过 5000 字";
    }
    if (this.draft.notes.length > 20_000) errors.notes = "备注不得超过 20000 字";
    return errors;
  }

  payload(): EditorPayload {
    const errors = this.validate();
    if (Object.keys(errors).length > 0) {
      throw new ItemEditorValidationError(errors);
    }
    const payload: EditorPayload = {
      contract: "b06-frozen-v1",
      tripId: this.tripId,
      tripDayId: this.dayId,
      kind: this.kind,
      target: this.draft.target.trim(),
      ...(this.draft.description.trim()
        ? { description: this.draft.description.trim() }
        : {}),
      schedule: {
        ...(this.draft.startTime ? { startTime: this.draft.startTime } : {}),
        ...(this.draft.endTime ? { endTime: this.draft.endTime } : {}),
        crossesMidnight: this.draft.crossesMidnight,
        ...(this.draft.durationMinutes === undefined
          ? {}
          : { durationMinutes: this.draft.durationMinutes }),
      },
    };
    if (this.draft.locationText.trim()) {
      payload.location = {
        text: this.draft.locationText.trim(),
        ...(this.draft.locationId ? { locationId: this.draft.locationId } : {}),
      };
    }
    if (
      this.draft.transportModeId
      || this.draft.transportOrigin
      || this.draft.transportDestination
    ) {
      payload.transport = {
        ...(this.draft.transportModeId
          ? { modeId: this.draft.transportModeId }
          : {}),
        ...(this.draft.transportOrigin
          ? { origin: this.draft.transportOrigin.trim() }
          : {}),
        ...(this.draft.transportDestination
          ? { destination: this.draft.transportDestination.trim() }
          : {}),
      };
    }
    const hospitality: NonNullable<EditorPayload["hospitality"]> = {};
    if (this.draft.diningName) {
      hospitality.dining = {
        name: this.draft.diningName.trim(),
        ...(this.draft.mealType ? { mealType: this.draft.mealType } : {}),
      };
    }
    if (this.draft.hotelName) {
      hospitality.accommodation = {
        name: this.draft.hotelName.trim(),
        ...(this.draft.accommodationType
          ? { type: this.draft.accommodationType }
          : {}),
        ...(this.draft.checkInDate
          ? { checkInDate: this.draft.checkInDate }
          : {}),
        ...(this.draft.checkOutDate
          ? { checkOutDate: this.draft.checkOutDate }
          : {}),
      };
    }
    for (const [key, value] of [
      ["reservationReference", this.draft.reservationReference],
      ["contactName", this.draft.contactName],
      ["contactPhone", this.draft.contactPhone],
    ] as const) {
      if (value.trim()) hospitality[key] = value.trim();
    }
    if (Object.keys(hospitality).length > 0) payload.hospitality = hospitality;
    if (this.draft.costAmount) {
      payload.cost = {
        amount: this.draft.costAmount,
        currency: this.draft.costCurrency,
        ...(this.draft.costCategory
          ? { category: this.draft.costCategory }
          : {}),
      };
    }
    if (this.draft.notes.trim()) payload.notes = this.draft.notes.trim();
    return payload;
  }
}

export class ItemEditorValidationError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(fieldErrors: Record<string, string>) {
    super("Item editor validation failed");
    this.name = "ItemEditorValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export function workspaceLayout(
  viewportWidth: number,
): "mobile" | "tablet" | "desktop" {
  if (viewportWidth < 768) return "mobile";
  if (viewportWidth < 1_120) return "tablet";
  return "desktop";
}
