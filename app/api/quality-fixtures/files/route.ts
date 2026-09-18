import { randomUUID, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { purchasingError } from "@/lib/purchasing-http";
import { FixtureError, inferBomMapping } from "@/lib/quality-fixture-domain";
import { readFixtureBom } from "@/lib/quality-fixture-bom";
import { lockFixtureBusiness, qfJson } from "@/lib/quality-fixture-service";
import { prisma } from "@/lib/prisma";
import { deleteObjectsBestEffort, putObject, signedUrl } from "@/lib/s3";
import { safeFilename, validateFileContent } from "@/lib/validation";
import { inspectMediaImage } from "@/lib/media-assets";
import { reconcileProductionPlanDrawingLinks } from "@/lib/planning-product-link";
import { synchronizeDrawingLibraryWorkOrderStatus } from "@/lib/drawing-library-lifecycle";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const q = req.nextUrl.searchParams, id = q.get("id") || "";
    if (q.get("kind") === "drawing") {
      const f = await prisma.drawingLibraryFile.findFirst({ where: { id, deletedAt: null, libraryItem: { deletedAt: null } } });
      if (!f) throw new FixtureError("图纸不存在", "FIXTURE_NOT_FOUND", 404);
      return NextResponse.redirect(await signedUrl({ key: f.objectKey, filename: f.displayName || f.originalName, disposition: "inline", contentType: f.mimeType }));
    }
    const f = await prisma.qfBomFile.findFirst({ where: { id, deletedAt: null, libraryItem: { deletedAt: null } } });
    if (!f) throw new FixtureError("BOM 不存在", "FIXTURE_NOT_FOUND", 404);
    if (q.get("parse") === "1") return NextResponse.json({ ok: true, data: { id: f.id, name: f.name, sheets: f.sheets, mapping: inferBomMapping(f.sheets as never) } });
    return NextResponse.redirect(await signedUrl({ key: f.objectKey, filename: f.name, disposition: "attachment" }));
  } catch (e) { return purchasingError(e); }
}
export async function POST(req: NextRequest) {
  let key = "";
  try {
    const actor = await requireUser();
    if (Number(req.headers.get("content-length") || 0) > 51 * 1024 * 1024) throw new FixtureError("上传文件超过大小限制");
    const form = await req.formData(), file = form.get("file"), kind = String(form.get("kind") || ""), libraryItemId = String(form.get("product") || "");
    if (!(file instanceof File) || !["bom", "drawing"].includes(kind)) throw new FixtureError("请选择图纸或 Excel BOM 文件");
    if (!await prisma.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null } })) throw new FixtureError("产品档案不存在");
    if (file.size > (kind === "bom" ? 10 : 50) * 1024 * 1024) throw new FixtureError(kind === "bom" ? "BOM 不能超过 10 MB" : "图纸不能超过 50 MB");
    const body = Buffer.from(await file.arrayBuffer());
    const sheets = kind === "bom" ? readFixtureBom(body, file.name) : null;
    if (kind === "drawing") {
      const error = validateFileContent(file.name, file.type, file.size, body);
      if (error) throw new FixtureError(error);
      if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) throw new FixtureError("生产图纸请上传 PDF、PNG、JPG 或 WebP，便于审核和打印");
    }
    const image = kind === "drawing" && file.type.startsWith("image/") ? await inspectMediaImage(body, file.type) : null;
    if (kind === "drawing" && file.type.startsWith("image/") && !image) throw new FixtureError("图片无效或像素过大");
    key = "quality-fixtures/" + libraryItemId + "/" + kind + "/" + randomUUID() + "-" + safeFilename(file.name);
    const sha256 = createHash("sha256").update(body).digest("hex"), mime = file.type || (kind === "bom" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    await putObject({ key, body, contentType: mime, originalName: file.name });
    const data = await prisma.$transaction(async tx => {
      await lockFixtureBusiness(tx);
      if (kind === "bom") {
        const draft = await tx.qfPackage.findFirst({ where: { id: String(form.get("package") || ""), libraryItemId, status: "DRAFT", needFixture: true } });
        if (!draft) throw new FixtureError("请先保存“需要治具”的资料草稿，再上传 BOM");
        const saved = await tx.qfBomFile.create({ data: { libraryItemId, name: file.name, objectKey: key, sha256, byteSize: file.size, sheets: qfJson(sheets), uploadedById: actor.id } });
        return { id: saved.id, name: saved.name, sheets, mapping: inferBomMapping(sheets!) };
      }
      const category = await tx.resourceCategory.findFirst({ where: { code: "drawing" } });
      if (!category) throw new FixtureError("图纸分类未初始化");
      // Share the archive uploader's lock so file version numbers remain unique.
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "drawing-library:" + libraryItemId + ":" + category.id);
      const versions = await tx.drawingLibraryFile.findMany({ where: { libraryItemId, categoryId: category.id }, select: { version: true } });
      const n = versions.reduce((max, f) => Math.max(max, Number(f.version.match(/^V1\.(\d+)$/i)?.[1] ?? -1)), -1) + 1;
      const asset = await tx.mediaAsset.create({ data: { originalObjectKey: key, sha256, mimeType: mime, byteSize: file.size, originalWidth: image?.width, originalHeight: image?.height, exifOrientation: image?.orientation } });
      const saved = await tx.drawingLibraryFile.create({ data: { libraryItemId, categoryId: category.id, originalName: file.name, displayName: file.name,
        mimeType: mime, size: file.size, objectKey: key, mediaAssetId: asset.id, sha256, sourceType: "MANUAL_UPLOAD", version: "V1." + n, uploadedById: actor.id, remark: "计划端生产资料上传，待两级审核" } });
      await tx.drawingLibraryItem.update({ where: { id: libraryItemId }, data: { updatedAt: new Date() } });
      await reconcileProductionPlanDrawingLinks(tx, { drawingLibraryItemId: libraryItemId });
      await synchronizeDrawingLibraryWorkOrderStatus(tx, libraryItemId);
      await tx.qfEvent.create({ data: { entityType: "PRODUCT", entityId: libraryItemId, action: "UPLOAD_DRAWING", actorId: actor.id,
        actorName: actor.displayName || actor.username, snapshot: qfJson({ fileId: saved.id, sha256, name: file.name }) } });
      return { id: saved.id, name: saved.originalName };
    }, { maxWait: 30000, timeout: 30000 });
    return NextResponse.json({ ok: true, data });
  } catch (e) { if (key) await deleteObjectsBestEffort([key]); return purchasingError(e); }
}
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireUser(), input = await req.json();
    const data = await prisma.$transaction(async tx => {
      await lockFixtureBusiness(tx);
      const bom = await tx.qfBomFile.findFirst({ where: { id: String(input.id), deletedAt: null } });
      if (!bom) throw new FixtureError("BOM 不存在");
      if (await tx.qfPackage.count({ where: { bomFileId: bom.id } })) throw new FixtureError("已关联资料版本的 BOM 需保留追溯，可上传新版本替换");
      await tx.qfBomFile.update({ where: { id: bom.id }, data: { deletedAt: new Date() } });
      await tx.qfEvent.create({ data: { entityType: "BOM", entityId: bom.id, action: "REMOVE_UNUSED", actorId: actor.id,
        actorName: actor.displayName || actor.username, snapshot: qfJson({ name: bom.name }) } });
      return { id: bom.id };
    });
    return NextResponse.json({ ok: true, data });
  } catch (e) { return purchasingError(e); }
}
