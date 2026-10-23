# 鸿蒙物料核验、附件预览与垫付金额更正 · v1.34.282

本目录提供部署配置，发布镜像不等于已经切换线上。两项资源应安装在主应用所在的 **同一 Sealos 命名空间**。

## 镜像

- 主应用：`crpi-2acb2dabuutklbx4.cn-hangzhou.personal.cr.aliyuncs.com/zhiju-b/hongmeng:v1.34.282`
- 转换服务：`crpi-2acb2dabuutklbx4.cn-hangzhou.personal.cr.aliyuncs.com/zhiju-b/hongmeng:office-preview-v1.34.282`
- 平台：`linux/amd64`。转换服务基于 Gotenberg 8.38.1 LibreOffice 版本，固定上游 manifest，并验证内置 Noto CJK、Carlito、Caladea 字体。
- 发布完成后的实际镜像摘要与验收证据见同目录 `release-verification.md`。

## 部署顺序

1. 按现有运维流程备份 PostgreSQL。确认主应用仍使用当前 S3 桶与数据库连接。
2. 在当前命名空间导入 `converter.yaml`，等待 `hongmeng-office-preview` 就绪。它仅提供集群内部 3000 端口，**不创建公网域名、Ingress 或 NodePort**。
3. `app.patch.yaml` 是现有主应用 Deployment 的增量补丁。把 `YOUR_EXISTING_APP_DEPLOYMENT` 和 `YOUR_EXISTING_APP_CONTAINER` 换成真实名称，再以 strategic merge 方式应用；不要把它当成完整应用配置覆盖原 Deployment。保留原有数据库、S3、登录密钥、域名、端口、资源限制等配置。
4. 主应用增加 `OFFICE_PREVIEW_URL=http://hongmeng-office-preview:3000`，Pod 标签增加 `hongmeng-office-client: "true"`，更新主应用镜像为本版本。转换服务的网络策略只接受该标签的同命名空间 Pod，并阻止所有主动出站连接。
5. 镜像启动入口会执行 Prisma migrate deploy。本次新增 `PcAmountCorrection` 审计/复核表，并允许纯金额差额以零退货数量记账；不会修改库存数量或原付款事实。旧版本缺失的预览迁移也会按顺序执行。预览工作进程由主应用入口自动启动，不需要额外 CronJob。

若通过 kubectl 操作，先设置真实命名空间并替换补丁里的两个名字：

```sh
kubectl -n YOUR_NAMESPACE apply -f converter.yaml
kubectl -n YOUR_NAMESPACE rollout status deployment/hongmeng-office-preview --timeout=180s
kubectl -n YOUR_NAMESPACE patch deployment/YOUR_EXISTING_APP_DEPLOYMENT --type=strategic --patch-file app.patch.yaml
kubectl -n YOUR_NAMESPACE rollout status deployment/YOUR_EXISTING_APP_DEPLOYMENT --timeout=300s
```

如果 Sealos 的应用界面不直接支持 Pod 标签或 NetworkPolicy，请在其 Kubernetes 资源界面编辑对应 Deployment。不能只新增环境变量而漏掉 `hongmeng-office-client` 标签，否则网络策略会阻止转换。
如果主应用已有出站限制，还需在原有网络策略中允许它访问转换服务的 TCP 3000 端口。

## 存储、资源与排队

- 原文件和派生 PDF / 表格缓存均保存到主应用现有 S3 桶；只在 PostgreSQL 保存任务状态、缓存键和工作表元数据。转换服务无 PVC，临时文件写入 `emptyDir`，请求完成后清理，Pod 销毁后目录清空。
- 建议主应用保留至少 2 GiB 内存供现有业务和表格解析使用。转换服务请求 0.25 CPU / 512 MiB，限制 2 CPU / 1536 MiB；临时卷最多 768 MiB。可依照实际文件规模调整，资源是配置上限而非费用承诺。
- 每个主应用副本一次处理一份文件；数据库租约防止同一附件重复领取，进程中断后自动恢复。转换服务处理队列上限 4，单请求 60 秒，主应用转换等待 75 秒，租约 180 秒。
- 不执行宏、不刷新外部连接、不向第三方预览站点发送文件。转换服务禁用远程下载、Webhook，并拒绝 LibreOffice 外部网络访问。NetworkPolicy 需要集群网络插件支持才能生效，镜像内的转换设置仍独立生效。

## 使用与兼容

- 打开经验知识后自动预览第一个附件；点附件名称或“预览”切换。支持 XLS、XLSX、DOC、DOCX，以及原有 PDF、图片。
- 新上传文件保存知识后进入队列；历史附件首次打开时自动生成，不需重新上传。已就绪的缓存跨重启复用。
- Excel 的表格视图可切换可见工作表、搜索当前表所有行、分页、缩放、冻结首行/首列、选择文字复制。保留格式化显示值（前导零、日期、长文本等）；合并单元格内容展开便于查找。显示原文件已保存的公式结果，缺失缓存值明确提示，不重新计算。
- Excel 的“版式预览”和 Word 使用转换后的 PDF，支持翻页、页码跳转、缩放、适宽和全屏。保留原文件下载入口。版式按 LibreOffice 可用字体和原打印区域生成，复杂 Office 专有功能不保证逐像素一致；表格视图用于查找打印区域之外的数据。
- 表格视图按有值单元格处理，格式延伸到 XFD 的空白尾部不会再触发矩形面积上限。每次读取当前区域最多 100 行、40 列，宽表可移动列范围；搜索覆盖当前工作表全部分块。保留原行列坐标，真实末尾数据不会被裁掉。
- 原件最大 50 MiB；每张工作表最多处理 50 万个有值单元格、1200 万字符，另有隔离解析进程的内存及时间保护。单表达到内容限制会明确提示，其他可处理表仍可预览；不再固定限制 50 个工作表或 256 列。PDF 最大 80 MiB。隐藏工作表和隐藏行不展开。
- 预览缓存版本已更新。旧附件（包括过去因范围过大失败的 Excel）首次打开时自动重新生成，无需重新上传；原件和下载内容保持不变。
- 转换失败可重试，原件保留。Excel 表格和 PDF 状态独立，PDF 故障不影响已成功生成的表格。删除附件或知识后，缓存接口同步拒绝访问。

## 上线验收与排障

1. 已登录账号打开一条历史 XLS / XLSX 和一条历史 DOC / DOCX；首次显示排队/生成状态，之后可预览。
2. Excel 切换工作表、搜索末尾型号、翻到第二页；检查前导零和数量。进入版式预览确认图片。Word 翻页并检查中文、表格、图片。
3. 上传新 Office 文件后保存，确认预览和原件下载均正常。刷新页面复用缓存，移除测试附件后旧预览 URL 应返回 404。
4. 若长期排队，检查主应用是否保留原镜像启动命令、日志中的 `[knowledge-preview]`、迁移状态。若显示转换失败，检查转换服务 `/health`、Pod 标签、NetworkPolicy、资源和 `OFFICE_PREVIEW_URL`。修复后点“重试预览”。不要为排障公开转换服务。
5. 回滚前先处理全部待复核的金额更正，并暂停采购资金操作，避免旧代码绕过新的更正复核。保留新增审计表、差额记录及 S3 原件；不要逆向删除迁移或更正历史。已发生纯金额差额时，应优先修复发布，旧页面不认识新的差额类型。

## 业务使用

- 物料追踪/仓库配料中，有仓库确认权限的用户可点“批量核验到料”，逐批核对实际可用量。少到、错料需填原因并继续补货；可以同时明确填写累计可配套产品套数。登记发货和报到仍分别保留，不会自动当作仓库核验。
- 已入库或已完成的个人垫付采购，采购经办可点“更正垫付金额”，填写新金额/单价及原因。无资金、票据事实时直接生效；已有资金申请由资金审批负责人复核，已有付款、票据或退款事实由财务复核。相关资金在复核期间暂停金额操作。
- 采购详情新增“金额更正”页签，查看前后金额、原因与复核结果。通过后释放原资金单未付余额，需按新余额重新申请；合并资金单的其他行也一并释放未付余额并通知申请人。已付金额、原发票、合同历史和库存流水保持原记录。
- 少报金额可补申请差额；多报已付款金额进入“退货与退款 / 更正差额”，财务按实际到账登记退款。发票需要红冲时仍单独处理，不会自动伪造收付款或票据。

## 上游资料

- https://gotenberg.dev/docs/convert-with-libreoffice/convert-to-pdf
- https://github.com/gotenberg/gotenberg/releases/tag/v8.38.1
