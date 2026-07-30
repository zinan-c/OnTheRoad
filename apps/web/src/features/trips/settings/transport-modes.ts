export type TransportModeView = {
  id: string;
  tripId: string | null;
  ownerId: string | null;
  code: string;
  label: string;
  icon: string;
  color: string;
  lineStyle: "solid" | "dashed" | "dotted" | "arc";
  isSystem: boolean;
  enabled: boolean;
  referenced: boolean;
  version: number;
  warning?: "已停用";
};

export type TransportModeInput = Pick<
  TransportModeView,
  "code" | "label" | "icon" | "color" | "lineStyle"
>;

type Gateway = {
  list: () => Promise<TransportModeView[]>;
  create: (input: TransportModeInput) => Promise<TransportModeView>;
  update: (
    id: string,
    patch: Partial<Omit<TransportModeInput, "code">>,
    expectedVersion: number,
  ) => Promise<TransportModeView>;
  deactivate: (
    id: string,
    expectedVersion: number,
  ) => Promise<TransportModeView>;
};

export class TransportModeCatalog {
  #modes: TransportModeView[] = [];
  readonly #listeners = new Set<(modes: TransportModeView[]) => void>();

  get modes(): TransportModeView[] {
    return structuredClone(this.#modes);
  }

  replace(modes: TransportModeView[]): void {
    this.#modes = structuredClone(modes);
    this.#emit();
  }

  upsert(mode: TransportModeView): void {
    const index = this.#modes.findIndex(({ id }) => id === mode.id);
    if (index === -1) this.#modes.push(structuredClone(mode));
    else this.#modes[index] = structuredClone(mode);
    this.#emit();
  }

  subscribe(listener: (modes: TransportModeView[]) => void): () => void {
    this.#listeners.add(listener);
    listener(this.modes);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    const snapshot = this.modes;
    for (const listener of this.#listeners) listener(snapshot);
  }
}

export class TransportModeSettings {
  readonly state: {
    pending: boolean;
    error: string | null;
    fieldErrors: Record<string, string>;
  } = { pending: false, error: null, fieldErrors: {} };

  readonly #gateway: Gateway;
  readonly catalog: TransportModeCatalog;

  constructor(gateway: Gateway, catalog = new TransportModeCatalog()) {
    this.#gateway = gateway;
    this.catalog = catalog;
  }

  async load(): Promise<void> {
    await this.#perform(async () => {
      this.catalog.replace(await this.#gateway.list());
    });
  }

  async create(input: TransportModeInput): Promise<TransportModeView> {
    this.state.fieldErrors = validateInput(input);
    if (Object.keys(this.state.fieldErrors).length > 0) {
      throw new Error("Transport mode form is invalid");
    }
    let created!: TransportModeView;
    await this.#perform(async () => {
      created = await this.#gateway.create(input);
      this.catalog.upsert(created);
    });
    return created;
  }

  async update(
    id: string,
    patch: Partial<Omit<TransportModeInput, "code">>,
  ): Promise<TransportModeView> {
    const current = this.catalog.modes.find((mode) => mode.id === id);
    if (!current) throw new Error("Transport mode is not loaded");
    if (current.isSystem) throw new Error("系统交通方式不可编辑");
    let updated!: TransportModeView;
    await this.#perform(async () => {
      updated = await this.#gateway.update(id, patch, current.version);
      this.catalog.upsert(updated);
    });
    return updated;
  }

  async deactivate(id: string): Promise<TransportModeView> {
    const current = this.catalog.modes.find((mode) => mode.id === id);
    if (!current) throw new Error("Transport mode is not loaded");
    if (current.isSystem) throw new Error("系统交通方式不可停用");
    let disabled!: TransportModeView;
    await this.#perform(async () => {
      disabled = await this.#gateway.deactivate(id, current.version);
      this.catalog.upsert(disabled);
    });
    return disabled;
  }

  async #perform(operation: () => Promise<void>): Promise<void> {
    this.state.pending = true;
    this.state.error = null;
    try {
      await operation();
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : "交通方式请求失败";
      throw error;
    } finally {
      this.state.pending = false;
    }
  }
}

export class TransportModeSelector {
  readonly state: { modes: TransportModeView[]; selectedCode: string | null } = {
    modes: [],
    selectedCode: null,
  };
  readonly #unsubscribe: () => void;

  constructor(catalog: TransportModeCatalog, selectedCode: string | null = null) {
    this.state.selectedCode = selectedCode;
    this.#unsubscribe = catalog.subscribe((modes) => {
      this.state.modes = modes;
    });
  }

  options(): TransportModeView[] {
    return this.state.modes
      .filter(
        ({ code, enabled }) => enabled || code === this.state.selectedCode,
      )
      .map((mode) => ({
        ...mode,
        ...(!mode.enabled ? { warning: "已停用" as const } : {}),
      }));
  }

  select(code: string): TransportModeView {
    const option = this.options().find((mode) => mode.code === code);
    if (!option || !option.enabled) {
      throw new Error("Transport mode is unavailable for new selection");
    }
    this.state.selectedCode = code;
    return option;
  }

  dispose(): void {
    this.#unsubscribe();
  }
}

export function validateInput(
  input: Partial<TransportModeInput>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.code ?? "")) {
    errors.code = "Code 使用 2–64 位大写字母、数字或下划线";
  }
  if (!input.label?.trim() || input.label.trim().length > 80) {
    errors.label = "名称必填且不得超过 80 字";
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.icon ?? "")) {
    errors.icon = "请选择已注册图标";
  }
  if (!/^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/u.test(input.color ?? "")) {
    errors.color = "颜色必须使用大写十六进制";
  }
  if (!["solid", "dashed", "dotted", "arc"].includes(input.lineStyle ?? "")) {
    errors.lineStyle = "请选择有效线型";
  }
  return errors;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderTransportModeSettings(
  settings: TransportModeSettings,
): string {
  const modes = settings.catalog.modes.map((mode) =>
    `<li data-mode="${escapeHtml(mode.code)}"><span aria-hidden="true" data-icon="${escapeHtml(mode.icon)}" style="color:${escapeHtml(mode.color)}"></span><strong>${escapeHtml(mode.label)}</strong><span>${escapeHtml(mode.code)}</span><span>线型：${escapeHtml(mode.lineStyle)}</span>${mode.isSystem ? "<span>系统</span>" : `<button data-action="edit" data-target="${escapeHtml(mode.id)}">编辑</button><button data-action="deactivate" data-target="${escapeHtml(mode.id)}"${mode.enabled ? "" : " disabled"}>${mode.enabled ? "停用" : "已停用"}</button>`}</li>`
  ).join("");
  const error = settings.state.error
    ? `<div role="alert">${escapeHtml(settings.state.error)}</div>`
    : "";
  return `<section aria-labelledby="transport-mode-heading"><h2 id="transport-mode-heading">交通方式设置</h2>${error}<form aria-label="新增自定义交通方式"><label for="mode-code">Code</label><input id="mode-code" name="code" autocomplete="off"><label for="mode-label">名称</label><input id="mode-label" name="label"><label for="mode-icon">图标</label><input id="mode-icon" name="icon"><label for="mode-color">颜色</label><input id="mode-color" name="color" placeholder="#RRGGBB"><label for="mode-line-style">线型</label><select id="mode-line-style" name="lineStyle"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option><option value="arc">弧线</option></select><button type="submit"${settings.state.pending ? " disabled" : ""}>新增交通方式</button></form><ul>${modes}</ul></section>`;
}
