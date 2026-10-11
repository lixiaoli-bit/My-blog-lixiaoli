import type { AstroCookies } from "astro";
import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, getPrimaryDb } from "../../db";
import {
  mindmaps,
  mindmapBindings,
  sourceBlockIndexes,
  mindmapBackups,
} from "../../db/schema.sqlite";
import type { Mindmap } from "../../db/types";
import { getArticleById } from "./articles";
import { getDocNode } from "./docs";
import { canManage, isTopAdmin } from "./admin-auth";
import {
  decideArticleGate,
  parsePasswordHash,
  isArticleUnlocked,
  decodeTokenPayload,
} from "./article-password";
import { verifySignedPayload } from "./auth";
import { buildSourceIndex } from "./source-block-index";
import { contentVersion } from "./article-content-version";
import { emptyMindmapData, parseMindmapData } from "./mindmaps";
import {
  sourceKey,
  sameSource,
  walkMap,
  validateMapDocument,
  type SourceTarget,
  type SourceIndex,
  type MapPayload,
  type MapDocument,
  type MapSource,
  type SourceRef,
} from "./mindmap-types";

export class MapError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function mapResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
export function mapFailure(error: unknown): Response {
  if (error instanceof MapError)
    return mapResponse(
      { error: error.message, details: error.details },
      error.status,
    );
  console.error("[mindmap]", error);
  return mapResponse({ error: "操作失败，请重试；本地修改仍保留" }, 500);
}
export function targetFrom(value: unknown): SourceTarget {
  const target = value as Partial<SourceTarget> | null;
  if (
    !target ||
    !["article", "doc"].includes(target.domain ?? "") ||
    typeof target.targetId !== "string" ||
    !target.targetId.trim() ||
    target.targetId.length > 200
  )
    throw new MapError("文章来源不合法");
  return {
    domain: target.domain as SourceTarget["domain"],
    targetId: target.targetId,
  };
}
export async function resolveSource(
  target: SourceTarget,
  cookies: AstroCookies,
  write = false,
): Promise<MapSource & { canEdit: boolean }> {
  const canEdit = await canManage(
    cookies,
    target.domain === "doc" ? "docs" : "articles",
  );
  if (write && !canEdit) throw new MapError("没有这篇文章的管理权限", 403);
  let content: string, title: string, url: string;
  if (target.domain === "doc") {
    const node = await getDocNode(target.targetId);
    if (!node || node.kind !== "article")
      throw new MapError("文档文章不存在", 404);
    content = node.content ?? "";
    title = node.title;
    url = `/doc/${encodeURIComponent(node.bundleId)}?article=${encodeURIComponent(node.id)}`;
  } else {
    const article = await getArticleById(target.targetId);
    if (!article) throw new MapError("文章不存在", 404);
    const gate = decideArticleGate(
      Boolean(article.encrypted),
      parsePasswordHash(article.encryptMeta),
      () =>
        isArticleUnlocked(
          cookies,
          article.id,
          verifySignedPayload,
          decodeTokenPayload,
        ),
    );
    if (gate.locked && !canEdit)
      throw new MapError("请先在原文页解锁文章", 403);
    content = article.content;
    title = article.title;
    url = `/blog/${encodeURIComponent(article.slug)}`;
  }
  const index = await sourceIndex(target, content);
  return { ...target, title, url, ...index, canEdit };
}
export async function sourceIndex(
  target: SourceTarget,
  content: string,
): Promise<SourceIndex> {
  const authority = getPrimaryDb(),
    id = sourceKey(target);
  for (let attempt = 0; attempt < 4; attempt++) {
    const [row] = await authority
      .select()
      .from(sourceBlockIndexes)
      .where(eq(sourceBlockIndexes.id, id));
    const previous = row ? (JSON.parse(row.data) as SourceIndex) : undefined;
    if (previous?.contentHash === contentVersion(content)) return previous;
    const index = await buildSourceIndex(content, previous),
      data = JSON.stringify(index),
      updatedAt = new Date();
    const changed = row
      ? await authority
          .update(sourceBlockIndexes)
          .set({ data, updatedAt })
          .where(
            and(
              eq(sourceBlockIndexes.id, id),
              eq(sourceBlockIndexes.data, row.data),
            ),
          )
          .returning()
      : await authority
          .insert(sourceBlockIndexes)
          .values({ id, data, updatedAt })
          .onConflictDoNothing()
          .returning();
    if (changed.length) {
      // The mirrored write also visits the primary. Never overwrite a newer CAS winner.
      if (row)
        await db
          .update(sourceBlockIndexes)
          .set({ data, updatedAt })
          .where(
            and(
              eq(sourceBlockIndexes.id, id),
              eq(sourceBlockIndexes.data, row.data),
            ),
          );
      else
        await db
          .insert(sourceBlockIndexes)
          .values({ id, data, updatedAt })
          .onConflictDoNothing();
      return index;
    }
  }
  throw new MapError("文章索引正在更新，请重试", 409);
}
export async function getBinding(target: SourceTarget) {
  const [binding] = await getPrimaryDb()
    .select()
    .from(mindmapBindings)
    .where(eq(mindmapBindings.id, sourceKey(target)));
  return binding ?? null;
}
export async function readMap(id: string): Promise<Mindmap | null> {
  const [row] = await getPrimaryDb()
    .select()
    .from(mindmaps)
    .where(eq(mindmaps.id, id));
  return row ?? null;
}
export async function mapPayload(
  id: string,
  cookies: AstroCookies,
  write = false,
): Promise<MapPayload> {
  const map = await readMap(id);
  if (!map) throw new MapError("思维导图不存在", 404);
  const [binding] = await getPrimaryDb()
    .select()
    .from(mindmapBindings)
    .where(eq(mindmapBindings.mapId, id));
  const articleBinding =
    !binding && map.articleId
      ? await getBinding({ domain: "article", targetId: map.articleId })
      : null;
  const target: SourceTarget | null = binding
    ? targetFrom(binding)
    : map.articleId && !articleBinding
      ? { domain: "article", targetId: map.articleId }
      : null;
  const source = target ? await resolveSource(target, cookies, write) : null;
  const canEdit = source
    ? source.canEdit
    : await canManage(cookies, "articles");
  if ((!source || write) && !canEdit)
    throw new MapError("没有导图访问权限", 403);
  const data = validateDocument(parseMindmapData(map.data));
  // Legacy ordinal anchors may have drifted. Upgrade only a uniquely confirmed quote.
  if (source)
    walkMap(data.root, (node) => {
      if (!node.data.sourceRef && (node.data.anchorId || node.data.snippet)) {
        const quote = String(node.data.snippet ?? "").trim();
        const matches = quote
          ? source.blocks.filter(
              (block) =>
                block.text.includes(quote) || block.markdown.includes(quote),
            )
          : [];
        if (matches.length === 1)
          node.data.sourceRef = reference(source, matches[0]!.blockId, quote);
        else node.data.referenceNeedsRepair = true;
      }
    });
  return {
    ...map,
    version: contentVersion(`${map.revision}:${map.title}:${map.data}`),
    data,
    updatedAt: map.updatedAt.toISOString(),
    source,
    canEdit,
    canAi: await isTopAdmin(cookies),
  };
}
export function validateDocument(value: unknown): MapDocument {
  try {
    return validateMapDocument(value);
  } catch (error) {
    throw new MapError(
      error instanceof Error ? error.message : "导图结构不合法",
    );
  }
}
export function reference(
  source: MapSource,
  blockId: string,
  quote = "",
): SourceRef {
  const block = source.blocks.find((item) => item.blockId === blockId);
  if (!block) throw new MapError("原文内容块已变化，请重新选择", 409);
  if (quote && !block.text.includes(quote) && !block.markdown.includes(quote))
    throw new MapError("选区与当前原文不一致，请重新选择", 409);
  return {
    domain: source.domain,
    targetId: source.targetId,
    blockId,
    fingerprint: block.fingerprint,
    quote: quote || block.text.slice(0, 500),
  };
}
export async function ensureMap(
  target: SourceTarget,
  cookies: AstroCookies,
  primaryId?: string,
): Promise<MapPayload> {
  const source = await resolveSource(target, cookies, true),
    authority = getPrimaryDb();
  let binding = await getBinding(target);
  const legacy =
    !binding && target.domain === "article"
      ? await authority
          .select()
          .from(mindmaps)
          .where(eq(mindmaps.articleId, target.targetId))
      : [];
  if (!binding && legacy.length > 1 && !primaryId)
    throw new MapError("请选择保留关联的主导图，其他导图将保留为独立图", 409, {
      choosePrimary: legacy.map(({ id, title }) => ({ id, title })),
    });
  if (primaryId && !(await isTopAdmin(cookies)))
    throw new MapError("历史多图仅站主可选择主图", 403);
  if (primaryId && !binding && !legacy.some((map) => map.id === primaryId))
    throw new MapError("主图不属于当前文章");
  const candidateId =
    legacy.find((map) => map.id === primaryId)?.id ??
    legacy[0]?.id ??
    randomUUID();
  const reservation = {
    id: sourceKey(target),
    ...target,
    mapId: candidateId,
    updatedAt: new Date(),
  };
  // Reserve the unique source first. Concurrent callers always materialize the winner's ID.
  await authority
    .insert(mindmapBindings)
    .values(reservation)
    .onConflictDoNothing();
  binding = (await getBinding(target))!;
  const record = {
    id: binding.mapId,
    title: source.title,
    articleId: target.domain === "article" ? target.targetId : null,
    data: JSON.stringify(emptyMindmapData(source.title)),
    revision: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await authority.insert(mindmaps).values(record).onConflictDoNothing();
  await db.insert(mindmapBindings).values(binding).onConflictDoNothing();
  await db
    .insert(mindmaps)
    .values((await readMap(binding.mapId))!)
    .onConflictDoNothing();
  for (const old of legacy.filter((map) => map.id !== binding.mapId)) {
    await db
      .insert(mindmapBackups)
      .values({
        id: `detach:${old.id}`,
        mapId: old.id,
        data: JSON.stringify(old),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .update(mindmaps)
      .set({
        articleId: null,
        revision: sql`${mindmaps.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(mindmaps.id, old.id), eq(mindmaps.articleId, target.targetId)),
      );
  }
  return mapPayload(binding.mapId, cookies);
}
export async function saveMap(
  id: string,
  revision: unknown,
  input: { data?: unknown; title?: unknown; version?: unknown },
  cookies: AstroCookies,
): Promise<MapPayload> {
  if (!Number.isInteger(revision) || Number(revision) < 0)
    throw new MapError("客户端缺少导图版本，请刷新或升级客户端", 428);
  const current = await mapPayload(id, cookies, true);
  if (typeof input.version !== "string")
    throw new MapError("客户端缺少完整版本标识，请刷新或升级客户端", 428);
  if (input.version !== current.version)
    throw new MapError("导图内容已在另一窗口或同步端变化，本地修改已保留", 409);
  const data =
    input.data === undefined
      ? current.data
      : validateDocument(
          typeof input.data === "string" ? JSON.parse(input.data) : input.data,
        );
  if (current.source)
    walkMap(data.root, (node) => {
      const ref = node.data.sourceRef;
      if (ref && !sameSource(ref, current.source!)) {
        // Preserve old references already present in the map; imports cannot introduce foreign sources.
        let existing = false;
        walkMap(current.data.root, (old) => {
          if (JSON.stringify(old.data.sourceRef) === JSON.stringify(ref))
            existing = true;
        });
        if (!existing) throw new MapError("第一版仅支持当前关联文章的引用");
      }
      if (
        ref &&
        sameSource(ref, current.source!) &&
        !current.source!.blocks.some((block) => block.blockId === ref.blockId)
      )
        node.data.referenceNeedsRepair = true;
    });
  const title =
    typeof input.title === "string"
      ? input.title.trim().slice(0, 100)
      : current.title;
  if (!title) throw new MapError("标题不能为空");
  const patch = {
    title,
    data: JSON.stringify(data),
    revision: Number(revision) + 1,
    updatedAt: new Date(),
  };
  const baseline = await readMap(id);
  if (
    !baseline ||
    contentVersion(
      `${baseline.revision}:${baseline.title}:${baseline.data}`,
    ) !== current.version
  )
    throw new MapError("导图刚刚变化，本地修改已保留，请处理冲突", 409);
  const changed = await getPrimaryDb()
    .update(mindmaps)
    .set(patch)
    .where(
      and(
        eq(mindmaps.id, id),
        eq(mindmaps.revision, Number(revision)),
        eq(mindmaps.data, baseline.data),
        eq(mindmaps.title, baseline.title),
      ),
    )
    .returning();
  if (!changed.length)
    throw new MapError(
      "另一窗口已保存较新版本。本地修改已保留，请处理冲突",
      409,
    );
  await db
    .update(mindmaps)
    .set(patch)
    .where(
      and(
        eq(mindmaps.id, id),
        eq(mindmaps.revision, Number(revision)),
        eq(mindmaps.data, baseline.data),
        eq(mindmaps.title, baseline.title),
      ),
    );
  return mapPayload(id, cookies);
}
