import type { EditorDraft, ItemEditor } from "./item-editor.js";
import type {
  ItineraryGateway,
  TimelineItem,
} from "./workspace.js";

export type AutosaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "disposed";

export type AutosaveState = {
  status: AutosaveStatus;
  dirtyFields: Array<keyof EditorDraft>;
  confirmedVersion: number | undefined;
  confirmedItemId: string | undefined;
  retryAvailable: boolean;
  conflict: boolean;
  offline: boolean;
  error: string | null;
};

type AutosaveGateway = {
  saveItem: NonNullable<ItineraryGateway["saveItem"]>;
};

type AutosaveOptions = {
  debounceMs?: number;
};

type SaveSnapshot = {
  revision: number;
  draft: EditorDraft;
};

export class ItineraryAutosave {
  state: AutosaveState;

  readonly #editor: ItemEditor;
  readonly #gateway: AutosaveGateway;
  readonly #debounceMs: number;
  #confirmedDraft: EditorDraft;
  #revision = 0;
  #latestIssuedRevision = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(
    editor: ItemEditor,
    gateway: AutosaveGateway,
    options: AutosaveOptions = {},
  ) {
    this.#editor = editor;
    this.#gateway = gateway;
    this.#debounceMs = options.debounceMs ?? 500;
    this.#confirmedDraft = structuredClone(editor.draft);
    this.state = {
      status: "idle",
      dirtyFields: [],
      confirmedVersion: editor.version,
      confirmedItemId: editor.itemId,
      retryAvailable: false,
      conflict: false,
      offline: false,
      error: null,
    };
  }

  update(input: Partial<EditorDraft>): void {
    if (this.#disposed) return;
    this.#editor.update(input);
    this.#revision += 1;
    this.refreshDirtyFields();
    this.state.status = "dirty";
    this.state.retryAvailable = false;
    this.state.conflict = false;
    this.state.offline = false;
    this.state.error = null;
    this.schedule();
  }

  async retry(): Promise<void> {
    if (this.#disposed || !this.state.retryAvailable) return;
    this.state.retryAvailable = false;
    this.state.conflict = false;
    this.state.offline = false;
    this.state.error = null;
    await this.issueSave();
  }

  async flush(): Promise<void> {
    if (this.#disposed || this.state.dirtyFields.length === 0) return;
    this.clearTimer();
    await this.issueSave();
  }

  dispose(): void {
    this.clearTimer();
    this.#disposed = true;
    this.state.status = "disposed";
  }

  hasUnsavedChanges(): boolean {
    return this.state.dirtyFields.length > 0
      || this.state.status === "saving"
      || this.state.status === "error"
      || this.state.status === "conflict";
  }

  statusText(): string {
    if (this.state.status === "saving") return "正在保存…";
    if (this.state.status === "saved") return "已保存";
    if (this.state.status === "conflict") return "版本冲突，请重试";
    if (this.state.status === "error") return this.state.error ?? "保存失败";
    if (this.state.status === "dirty") return "有未保存更改";
    return "";
  }

  private schedule(): void {
    this.clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.issueSave();
    }, this.#debounceMs);
  }

  private async issueSave(): Promise<void> {
    if (this.#disposed || this.state.dirtyFields.length === 0) return;
    const snapshot: SaveSnapshot = {
      revision: this.#revision,
      draft: structuredClone(this.#editor.draft),
    };
    this.#latestIssuedRevision = snapshot.revision;
    this.state.status = "saving";

    let saved: TimelineItem;
    try {
      const payload = this.#editor.payload();
      saved = await this.#gateway.saveItem(payload, {
        ...(this.state.confirmedItemId
          ? { itemId: this.state.confirmedItemId }
          : {}),
        ...(this.state.confirmedVersion === undefined
          ? {}
          : { version: this.state.confirmedVersion }),
      });
    } catch (error) {
      this.handleFailure(snapshot, error);
      return;
    }
    this.handleSuccess(snapshot, saved);
  }

  private handleSuccess(snapshot: SaveSnapshot, saved: TimelineItem): void {
    if (this.#disposed || snapshot.revision < this.#latestIssuedRevision) return;
    this.#confirmedDraft = snapshot.draft;
    this.state.confirmedVersion = saved.version;
    this.state.confirmedItemId = saved.id;
    this.state.retryAvailable = false;
    this.state.conflict = false;
    this.state.offline = false;
    this.state.error = null;
    this.refreshDirtyFields();
    this.state.status = this.state.dirtyFields.length === 0 ? "saved" : "dirty";
  }

  private handleFailure(snapshot: SaveSnapshot, error: unknown): void {
    if (this.#disposed || snapshot.revision < this.#latestIssuedRevision) return;
    const status = statusOf(error);
    const conflict = status === 409;
    const offline = status === 0 || isOfflineError(error);
    this.refreshDirtyFields();
    this.state.status = conflict ? "conflict" : "error";
    this.state.retryAvailable = true;
    this.state.conflict = conflict;
    this.state.offline = offline;
    this.state.error = conflict
      ? "版本冲突"
      : offline
        ? "网络不可用"
        : messageOf(error);
  }

  private refreshDirtyFields(): void {
    this.state.dirtyFields = (Object.keys(this.#editor.draft) as Array<keyof EditorDraft>)
      .filter((field) => this.#editor.draft[field] !== this.#confirmedDraft[field]);
  }

  private clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function isOfflineError(error: unknown): boolean {
  return error instanceof TypeError
    || (error instanceof Error && /offline|network|fetch/u.test(error.message));
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "保存失败";
}
