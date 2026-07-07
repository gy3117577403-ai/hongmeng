# 本地图纸原图批量导入指南

版本：v1.14.1-bulk-original-drawing-import

状态：本地工具与上线前候选能力。默认只做 dry-run，不会写库、不会上传 S3。

## 目标

把企业微信微盘已下载到本地的图纸原图批量导入到“图纸资料库”的“原图”分类，便于后续按客户和规格长期复用。

默认扫描目录：

```text
C:\Users\31175\Desktop\图纸
```

建议目录结构：

```text
图纸/
  昆泰/
    D010304-8222-V03-KTP304电源线DCDC.pdf
  伶利界/
    GRQ05BAT-Switch-V1.pdf
```

## 安全边界

- 只导入“原图”分类。
- 不导入 SOP、成品图、辅料规格、注意事项。
- 不影响生产工单资料库。
- 不影响连接器参数资料库。
- 不删除数据库记录。
- 不删除 S3 / Object Storage 对象。
- 默认 dry-run，不上传文件。
- 正式执行必须设置 `CONFIRM_BULK_ORIGINAL_UPLOAD=YES`。
- 不要把账号密码写入脚本、README、报告或 Git。

## 支持文件

支持：

- PDF
- JPG / JPEG
- PNG
- WEBP

会跳过：

- 空文件
- 临时文件
- 隐藏文件
- 疑似非原图文件名，例如包含 `SOP`、`成品`、`辅料`、`说明`、`注意`、`指导书`

如确需导入疑似非原图文件，可加：

```bash
--allow-suspected-non-original
```

## 客户别名

示例配置：

```text
config/customer-aliases.example.json
```

本地真实配置：

```text
config/customer-aliases.local.json
```

`customer-aliases.local.json` 已加入 `.gitignore`，不要提交真实客户映射、账号或任何密钥。

示例：

```json
{
  "昆泰": "杭州昆泰(10033)",
  "云深处": "杭州云深处"
}
```

脚本会优先使用本地配置覆盖示例配置。

## 规格识别

脚本会从文件名中尝试提取规格，规则包括：

- 已存在图纸资料库规格全文匹配
- `1CA1-C011`、`1CA4-X01`、`1CA5-X100` 这类 1CA 系列规格
- `D010304-8222-V03` 这类 D 开头规格
- `BOA12345`
- `P12345`
- `GRQ` / `XL` / `TY` / `HBTZ` 开头的字母数字连字符规格
- 以字母/数字开头、包含连字符、后面接中文说明的通用前缀规格，例如 `ABC123-X01(说明)`、`1T21-X10B-陀螺仪线`

如果无法识别规格，会进入 `unmatched.csv`，需要人工改文件名或补别名后重新 dry-run。

品名提取会优先使用文件名去掉规格后的剩余文本，并清理开头的下划线、空格、中英文括号外壳和 `版本` 标记。例如：

- `1CA1-C011_串口调试线.pdf` -> 规格 `1CA1-C011`，品名 `串口调试线`
- `1CA4-X01(髋电机线束）.pdf` -> 规格 `1CA4-X01`，品名 `髋电机线束`
- `P251325003（微动开关连接线-1配3套）.pdf` -> 规格 `P251325003`，品名 `微动开关连接线-1配3套`

## dry-run

先执行：

```bash
npm run drawings:bulk-originals:dry -- --source "C:\Users\31175\Desktop\图纸"
```

dry-run 只扫描、匹配并生成报告，不上传文件。

如果没有提供登录环境变量，dry-run 仍会输出本地解析结果：

- `onlineIndexAvailable=false` 表示没有读取线上图纸资料库索引。
- `duplicateCheckSkipped=true` 表示未做线上重复文件校验。
- `locallyParsedFiles` 表示本地已识别客户和规格的文件数。
- `readyForOnlineCheckFiles` 表示需要登录后再做线上存在性和重复性检查的文件数。
- `matched.csv` 中这类记录的 `action` 会显示为 `readyForOnlineCheck`。

常用参数：

```bash
npm run drawings:bulk-originals:dry -- --source "C:\Users\31175\Desktop\图纸" --limit 50
npm run drawings:bulk-originals:dry -- --source "C:\Users\31175\Desktop\图纸" --create-missing
npm run drawings:bulk-originals:dry -- --source "C:\Users\31175\Desktop\图纸" --strict
```

## 正式执行

确认报告无误后执行：

```powershell
$env:CONFIRM_BULK_ORIGINAL_UPLOAD="YES"
$env:BULK_UPLOAD_USERNAME="你的登录账号"
$env:BULK_UPLOAD_PASSWORD="运行时临时输入或临时设置，执行后立即清除"
npm run drawings:bulk-originals -- --execute --source "C:\Users\31175\Desktop\图纸"
Remove-Item Env:\CONFIRM_BULK_ORIGINAL_UPLOAD
Remove-Item Env:\BULK_UPLOAD_USERNAME
Remove-Item Env:\BULK_UPLOAD_PASSWORD
```

推荐不要长期保存 `BULK_UPLOAD_PASSWORD`。如果未设置密码，脚本会在执行时提示输入，不会把密码写入报告。

默认接口地址：

```text
https://qdowqencjyph.sealoshzh.site
```

可用 `BULK_UPLOAD_BASE_URL` 或 `--base-url` 指向本地环境。

## 报告

每次运行会生成：

```text
reports/bulk-original-drawings/<timestamp>/
```

包含：

- `summary.json`
- `matched.csv`
- `unmatched.csv`
- `duplicates.csv`
- `uploaded.csv`
- `failed.csv`
- `created-items.csv`

报告目录已加入 `.gitignore`，不要提交真实企业文件名报告。

## API

新增只读索引接口：

```text
GET /api/drawing-library/bulk-index
```

要求登录。接口返回图纸资料库匹配所需的客户、规格、分类和已存在文件摘要，不返回 S3 Secret、数据库连接串、签名下载链接或对象存储密钥。

上传复用现有接口：

```text
POST /api/drawing-library/[id]/files/upload
```

脚本会传入 `categoryName=原图`，确保只进入原图分类。

## 验收建议

1. 先用少量样本 dry-run。
2. 检查 `unmatched.csv` 是否都是需要人工处理的文件。
3. 检查 `duplicates.csv` 是否符合预期。
4. 检查 `matched.csv` 中客户和规格是否正确。
5. 正式执行前先设置 `--limit 10` 小批量验证。
6. 登录页面查看图纸资料库，确认只新增“原图”文件。

## 已知限制

- 浏览器页面不能直接扫描本地任意文件夹，因此批量导入必须通过命令行工具执行。
- 文件名规格提取不是 OCR，不读取 PDF 内容。
- 客户简称和真实客户名称不一致时，需要维护本地别名配置。
- 默认跳过疑似 SOP、成品图、辅料和说明类文件，避免误入原图分类。

本文档不包含数据库密码、`DATABASE_URL`、S3 Secret Key、`SESSION_SECRET`、账号密码或任何真实密钥。
