import { randomUUID, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { purchasingError } from "@/lib/purchasing-http";
import { FixtureError } from "@/lib/quality-fixture-domain";
import { putObject, deleteObjectsBestEffort, signedUrl } from "@/lib/s3";
import { safeFilename, validateFileContent } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const file = await prisma.qfReviewAttachment.findFirst({ where: { id: req.nextUrl.searchParams.get("id") || "", libraryItem: { deletedAt: null } } });
    if (!file) throw new FixtureError("说明附件不存在", "FIXTURE_NOT_FOUND", 404);
    return NextResponse.redirect(await signedUrl({ key: file.objectKey, filename: file.name, disposition: "attachment", contentType: file.mimeType }));
  } catch (e) { return purchasingError(e); }
}

export async function POST(req: NextRequest) {
  let key = "";
  try {
    const actor = await requireUser();
    if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024) throw new FixtureError("说明附件不能超过 10 MB");
    const form = await req.formData(), file = form.get("file"), libraryItemId = String(form.get("product") || "");
    if (!(file instanceof File) || !/\.(pdf|png|jpe?g|webp)$/i.test(file.name)) throw new FixtureError("请上传 PDF 或图片说明附件");
    if (file.size > 10 * 1024 * 1024) throw new FixtureError("说明附件不能超过 10 MB");
    if (!await prisma.drawingLibraryItem.findFirst({ where: { id: libraryItemId, deletedAt: null } })) throw new FixtureError("产品不存在");
    const body = Buffer.from(await file.arrayBuffer()), error = validateFileContent(file.name, file.type, file.size, body);
    if (error) throw new FixtureError(error);
    key = `quality-review/${libraryItemId}/${randomUUID()}-${safeFilename(file.name)}`;
    await putObject({ key, body, originalName: file.name, contentType: file.type || "application/octet-stream" });
    const saved = await prisma.qfReviewAttachment.create({ data: { libraryItemId, name: file.name, objectKey: key,
      mimeType: file.type || "application/octet-stream", byteSize: file.size, sha256: createHash("sha256").update(body).digest("hex"), uploadedById: actor.id } });
    return NextResponse.json({ ok: true, data: { id: saved.id, name: saved.name } });
  } catch (e) { if (key) await deleteObjectsBestEffort([key]); return purchasingError(e); }
}
