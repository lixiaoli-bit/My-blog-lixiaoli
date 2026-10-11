import type { MapDocument } from "./mindmap-types";
export type PendingMap = {
  revision: number;
  version?: string;
  data: MapDocument;
  title: string;
};
export class MindmapSaveQueue {
  pending: PendingMap | null = null;
  conflict = false;
  private running: Promise<boolean> | null = null;
  constructor(
    public revision: number,
    private write: (snapshot: PendingMap) => Promise<number>,
    private persist: (snapshot: PendingMap | null) => void,
    private state: (label: string) => void,
    public version?: string,
  ) {}
  enqueue(data: MapDocument, title: string) {
    this.pending = {
      revision: this.revision,
      version: this.version,
      data: structuredClone(data),
      title,
    };
    this.persist(this.pending);
    this.state(this.conflict ? "版本冲突 · 本地修改已保留" : "未保存");
  }
  async flush(): Promise<boolean> {
    if (this.running) {
      await this.running;
      return this.pending && !this.conflict ? this.flush() : !this.pending;
    }
    if (!this.pending || this.conflict) return !this.pending;
    const snapshot = this.pending;
    snapshot.revision = this.revision;
    snapshot.version = this.version;
    this.state("正在保存…");
    this.running = (async () => {
      try {
        this.revision = await this.write(snapshot);
        if (this.pending === snapshot) this.pending = null;
        else if (this.pending) {
          this.pending.revision = this.revision;
          this.pending.version = this.version;
        }
        this.persist(this.pending);
        this.state(this.pending ? "未保存" : "已保存");
        return true;
      } catch (error) {
        this.conflict = (error as { status?: number }).status === 409;
        this.state(
          error instanceof Error ? error.message : "保存失败 · 本地修改已保留",
        );
        return false;
      } finally {
        this.running = null;
      }
    })();
    const ok = await this.running;
    return ok && this.pending ? this.flush() : ok;
  }
}
