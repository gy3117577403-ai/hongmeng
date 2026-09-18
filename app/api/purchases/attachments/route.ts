import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { putObject, signedUrl, deleteObjectsBestEffort } from "@/lib/s3";
import { PurchasingError, pcText } from "@/lib/purchasing-domain";
import { purchasingError } from "@/lib/purchasing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  try {
    const a = await requireUser();
    if (Number(req.headers.get("content-length") || 0) > 21 * 1024 * 1024)
      throw new PurchasingError("附件不能超过 20 MB");
    const form = await req.formData(),
      f = form.get("file");
    if (!(f instanceof File) || !f.size || f.size > 20 * 1024 * 1024)
      throw new PurchasingError("请选择 20 MB 以内的 PDF 或图片");
    const body = Buffer.from(await f.arrayBuffer());
    const type =
      body.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : body[0] === 255 && body[1] === 216 && body[2] === 255
          ? "image/jpeg"
          : body
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : body.subarray(0, 4).toString() === "RIFF" &&
                body.subarray(8, 12).toString() === "WEBP"
              ? "image/webp"
              : "";
    if (!type)
      throw new PurchasingError("仅支持真实的 PDF、JPG、PNG、WebP 文件");
    const name = f.name.slice(0, 200),
      key = `purchasing/${a.id}/${randomUUID()}`;
    await putObject({ key, body, contentType: type, originalName: name });
    try {
      const saved = await prisma.pcAttachment.create({
        data: {
          objectKey: key,
          originalName: name,
          contentType: type,
          size: body.length,
          actorId: a.id,
          actorName: a.displayName || a.username,
        },
      });
      return NextResponse.json({
        ok: true,
        data: { id: saved.id, originalName: saved.originalName },
      });
    } catch (e) {
      await deleteObjectsBestEffort([key]);
      throw e;
    }
  } catch (e) {
    return purchasingError(e);
  }
}
export async function GET(req: NextRequest) {
  try {
    const a = await requireUser(),
      f = await prisma.pcAttachment.findFirst({
        where: {
          id: pcText(req.nextUrl.searchParams.get("id"), "附件", 100),
          deletedAt: null,
        },
      });
    if (!f || (f.entityType === "STAGED" && f.actorId !== a.id))
      throw new PurchasingError(
        "附件不存在或已移除",
        "PURCHASING_NOT_FOUND",
        404,
      );
    return NextResponse.redirect(
      await signedUrl({
        key: f.objectKey,
        filename: f.originalName,
        disposition: req.nextUrl.searchParams.has("download")
          ? "attachment"
          : "inline",
        contentType: f.contentType,
      }),
    );
  } catch (e) {
    return purchasingError(e);
  }
}
