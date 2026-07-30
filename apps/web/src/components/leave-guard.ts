export type BeforeUnloadEventLike = {
  preventDefault: () => void;
  returnValue: string | boolean;
};

export type BeforeUnloadTarget = {
  addEventListener: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEventLike) => void,
  ) => void;
  removeEventListener: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEventLike) => void,
  ) => void;
};

export type LeaveReason = "unsaved" | "upload" | "large-edit";

export class LeaveGuard {
  #uploadInProgress = false;
  #largeEditInProgress = false;
  #mountedTarget: BeforeUnloadTarget | undefined;
  readonly #beforeUnloadListener = (event: BeforeUnloadEventLike): void => {
    this.handleBeforeUnload(event);
  };

  constructor(private readonly hasUnsavedChanges: () => boolean) {}

  reasons(): LeaveReason[] {
    const reasons: LeaveReason[] = [];
    if (this.hasUnsavedChanges()) reasons.push("unsaved");
    if (this.#uploadInProgress) reasons.push("upload");
    if (this.#largeEditInProgress) reasons.push("large-edit");
    return reasons;
  }

  shouldPrompt(): boolean {
    return this.reasons().length > 0;
  }

  message(): string {
    const reasons = this.reasons();
    if (reasons.includes("upload")) return "上传仍在进行，离开可能中断处理。";
    if (reasons.includes("large-edit")) return "大型编辑尚未完成，确定离开吗？";
    return reasons.includes("unsaved") ? "有尚未保存的更改，确定离开吗？" : "";
  }

  requestLeave(confirmLeave: (message: string) => boolean): boolean {
    return !this.shouldPrompt() || confirmLeave(this.message());
  }

  handleBeforeUnload(event: BeforeUnloadEventLike): boolean {
    if (!this.shouldPrompt()) return false;
    event.preventDefault();
    event.returnValue = "";
    return true;
  }

  setUploadInProgress(active: boolean): void {
    this.#uploadInProgress = active;
  }

  setLargeEditInProgress(active: boolean): void {
    this.#largeEditInProgress = active;
  }

  mount(target: BeforeUnloadTarget): void {
    if (this.#mountedTarget === target) return;
    this.unmount();
    this.#mountedTarget = target;
    target.addEventListener("beforeunload", this.#beforeUnloadListener);
  }

  unmount(): void {
    this.#mountedTarget?.removeEventListener(
      "beforeunload",
      this.#beforeUnloadListener,
    );
    this.#mountedTarget = undefined;
  }
}
