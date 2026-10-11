import { REF_MIME, type SourceTarget } from "./mindmap-types";

export interface MapDragReference {
  version: 1;
  source: SourceTarget;
  blockId: string;
  fingerprint: string;
  quote: string;
  text: string;
}
const prefix = "byqx-mindmap-reference:v1\n";
type DragTransfer = Pick<DataTransfer, "types" | "getData" | "setData">;

export function writeMapDrag(transfer: DragTransfer, value: MapDragReference) {
  const json = JSON.stringify(value);
  transfer.setData(REF_MIME, json);
  // Electron/OS transfers can strip custom MIME types between native windows.
  transfer.setData("text/plain", prefix + json);
}
export function acceptsMapDrag(transfer: Pick<DataTransfer, "types">) {
  return transfer.types.includes(REF_MIME) || transfer.types.includes("text/plain");
}
export function readMapDrag(transfer: Pick<DataTransfer, "getData">): MapDragReference {
  const custom = transfer.getData(REF_MIME);
  const plain = transfer.getData("text/plain");
  if (!custom && !plain.startsWith(prefix))
    throw new Error("请从文章卡片的“拖入导图”手柄拖入，或使用“＋导图”");
  const raw = custom || plain.slice(prefix.length);
  if (raw.length > 20000) throw new Error("拖拽数据过大，请重新选择卡片");
  const value = JSON.parse(raw) as MapDragReference;
  if (value?.version !== 1 || !["article", "doc"].includes(value.source?.domain) ||
      typeof value.source?.targetId !== "string" || !value.source.targetId ||
      typeof value.blockId !== "string" || !value.blockId ||
      typeof value.fingerprint !== "string" ||
      typeof value.quote !== "string" || typeof value.text !== "string")
    throw new Error("拖拽引用数据不完整，请重新选择卡片");
  return value;
}
