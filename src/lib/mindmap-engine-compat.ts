type LineState = { isCreatingLine: boolean; creatingStartNode: unknown };
type LineCheck = (this: LineState, ...args: unknown[]) => unknown;
const guarded = new WeakSet<object>();

/** The engine throttles overlap checks. A queued check can run after line creation is cancelled. */
export function guardAssociativeLine(plugin: unknown): void {
  const prototype = (plugin as { prototype: { checkOverlapNode: LineCheck } })
    .prototype;
  if (guarded.has(prototype)) return;
  const original = prototype.checkOverlapNode;
  prototype.checkOverlapNode = function (...args) {
    if (!this.isCreatingLine || !this.creatingStartNode) return;
    return original.apply(this, args);
  };
  guarded.add(prototype);
}
