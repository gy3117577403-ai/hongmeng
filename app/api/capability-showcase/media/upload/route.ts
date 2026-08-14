import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import {
  ensureCapabilityShowcaseSite,
  serializeCapabilityShowcaseMedia,
} from '@/lib/capability-showcase-service';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFileContent } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) {
      return NextResponse.json({ ok: false, error: '请选择图片文件' }, { status: 400 });
    }
    if (!['jpg', 'png', 'webp'].includes(fileType(upload.name, upload.type))) {
      return NextResponse.json({ ok: false, error: '仅支持 JPG、PNG、WEBP 图片' }, { status: 400 });
    }
    const body = Buffer.from(await upload.arrayBuffer());
    const validationError = validateFileContent(upload.name, upload.type, upload.size, body);
    if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    const site = await ensureCapabilityShowcaseSite(user.id);
    const objectKey = `capability-showcase/${site.id}/${crypto.randomUUID()}-${safeFilename(upload.name)}`;
    const mimeType = upload.type || 'application/octet-stream';
    await putObject({ key: objectKey, body, contentType: mimeType, originalName: upload.name });

    let media;
    try {
      media = await prisma.capabilityShowcaseMedia.create({
        data: {
          siteId: site.id,
          objectKey,
          originalName: upload.name.slice(0, 240),
          displayName: String(form.get('displayName') || '').trim().slice(0, 120) || null,
          altText: String(form.get('altText') || '').trim().slice(0, 180) || null,
          mimeType,
          size: BigInt(upload.size),
          createdBy: user.id,
        },
      });
    } catch (error) {
      await deleteObjectsBestEffort([objectKey]);
      throw error;
    }
    await logOp({
      userId: user.id,
      action: 'upload_capability_showcase_media',
      targetType: 'capability_showcase_media',
      targetId: media.id,
      detail: { mimeType, size: upload.size },
    });
    return NextResponse.json({ ok: true, media: serializeCapabilityShowcaseMedia(media) });
  } catch (error) {
    return capabilityShowcaseApiError(error, '图片上传失败');
  }
}
