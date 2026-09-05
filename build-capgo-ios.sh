#!/usr/bin/env bash
# ============================================================================
#  Capgo Cloud Build —— 云端 Mac 编译 iOS IPA（你本地不需要 Mac）
# ----------------------------------------------------------------------------
#  重要：本脚本必须在「能正常访问 internet + Capgo 服务器」的机器上运行
#        （受限网络沙箱连不上 api.capgo.app，无法从这里触发）。
#
#  前置准备：
#   1) 把你的发布签名文件放到本目录的 certs/ 下：
#        certs/dist.p12                  # 发布证书（.p12，Distribution）
#        certs/profile.mobileprovision   # 描述文件（Ad Hoc 或 App Store）
#   2) 设置环境变量（切勿把密钥写进文件或粘贴到聊天里）：
#        export CAPGO_TOKEN="你的 Capgo API Key"   # 账号需有 Cloud Build 权限
#        export P12_PASSWORD="你的 .p12 证书密码"
#   3) 安装 Node.js（自带 npx）。
#
#  关于产物：
#   默认用 --output-upload，Capgo 会把编译好的 IPA 上传到限时下载链接
#   （你要的是「安装包」）。拿到 IPA 后用 LCSign 在 iPhone 上签名安装
#   （需先用 Sideloadly 把 LCSign 的 IPA 侧载进手机）。若想直接提交
#   App Store Connect/TestFlight，去掉 --output-upload 并补充
#   --apple-id / --apple-app-specific-password 等参数。
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")"          # 切到 fitness-app 目录

APP_ID="com.yi.fitness"

echo "==> 1/4 注册 App 到 Capgo（已注册会提示，可忽略）"
npx --yes @capgo/cli@latest app add "$APP_ID" || true

echo "==> 2/4 保存 iOS 签名凭证（仅本次构建使用，Capgo 不永久存储）"
npx --yes @capgo/cli@latest build credentials save \
  --appId "$APP_ID" --platform ios \
  --certificate ./certs/dist.p12 \
  --p12-password "$P12_PASSWORD" \
  --provisioning-profile ./certs/profile.mobileprovision

echo "==> 3/4 发起云端构建（Capgo 的 Mac Mini M4 上编译）"
npx --yes @capgo/cli@latest build request "$APP_ID" \
  --platform ios --path . --output-upload

echo "==> 完成 ✅  终端会实时输出日志，并在最后给出 IPA 的限时下载链接。"
echo "    可用 --output-retention <分钟> 控制下载链接保留时长。"
