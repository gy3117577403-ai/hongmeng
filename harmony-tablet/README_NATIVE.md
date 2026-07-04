# HongmengWorkorderTablet

这是工单资料库的鸿蒙平板原生 App 工程，目标版本为 `v2.0.0-native-rc.1`。

## 工程说明
- 工程目录：`harmony-tablet`
- 技术栈：ArkTS / ArkUI / Stage 模型
- 包名：`com.factory.workorder`
- 模块：`entry`
- 设备优先级：Tablet
- 主界面不使用 WebView，不套壳现有网页
- 数据通过 HTTPS API 调用 Sealos 后端

## DevEco Studio 打开方法
1. 打开 DevEco Studio。
2. 选择 Open Project。
3. 选择英文路径下的 `C:\Dev\hongmeng\harmony-tablet`。
4. 等待 ohpm / hvigor 同步。
5. 如果 SDK 版本提示不匹配，按本机 DevEco 推荐版本修正 `compatibleSdkVersion`。

## API 配置
默认服务器地址位于：

```text
entry/src/main/ets/constants/api.ets
```

默认值：

```text
https://qdowqencjyph.sealoshzh.site
```

该地址为公开服务地址。工程不包含数据库连接、对象存储凭据或任何密钥。

## 当前已实现功能
- 登录页
- Bearer token HTTP 客户端
- token 和当前用户本地 preferences 持久化
- 工作台页面
- 顶部栏
- 当前工单信息条
- 覆盖式工单抽屉
- 资料分类栏
- 图片原生 Image 预览
- PDF 文件卡片和下载 / 打开入口占位
- 右侧资料工具窗
- 连接器参数搜索和表格
- 设置页

## 当前未实现功能
- 原生文件选择器上传
- 原生相机拍照上传
- 原生 PDF 完整渲染
- 系统状态详情页
- 连接器参数原生导入预览

## 如何运行
1. 在 DevEco Studio 中打开工程。
2. 连接鸿蒙平板或启动 Tablet 模拟器。
3. 选择 `entry` 模块。
4. 点击 Run。
5. 登录后进入工作台。

## 真机调试
- 确认平板网络可访问服务器地址。
- 首次使用拍照上传前，需要在真机上确认相机权限。
- 当前 RC 版本上传按钮为能力入口，文件选择和相机上传需要下一步在 DevEco 真机环境补齐。
