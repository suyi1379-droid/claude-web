# NOTICE / 声明

## 原项目

- 名称：Claude Web 2.0
- 原作者：**lulu**
- GitHub：[@claudenoshujin](https://github.com/claudenoshujin)
- 原仓库：<https://github.com/claudenoshujin/claude-web>
- 原仓库中的 README、更新日志、图标、美术与代码版权归原作者所有。

## 本仓库

本仓库是 Claude Web 2.0 的**非官方修改版（fork）**，由 **suyi1379-droid** 维护。

- 维护者 GitHub：<https://github.com/suyi1379-droid>
- 联系邮箱：suyi1379@gmail.com
- 本仓库地址：<https://github.com/suyi1379-droid/claude-web>

本仓库与原作者 lulu 无隶属关系，也不代表原作者发布或认可。原作者正在开发的 3.0 与本仓库无关。

## 本修改版包含的改动

日期：2026-10-20

- 修复“扁平 / 气泡 / 文档”三种聊天样式被扩展主题 CSS 的 `!important` 规则覆盖的问题。
- 修复输入框字号不跟随酒馆“字体缩放”的问题；去掉手机正文重复乘 `--fontScale` 的二次缩放。
- 把酒馆原生“聊天宽度”滑杆映射到桌面消息列、输入框和标题列宽。
- 2.0.154 新增“图片像素画化”：聊天图片可转为半调网点，支持网点尺寸、色阶数量、保留原图原色、反转明暗和墨色；灵感来自 Folia 的 HalftoneDots。
- 2.0.155 图片像素画化新增“同时处理背景图”（默认开启），切换背景自动重处理，关闭恢复原背景。
- 2.0.156 图片像素画化提升精细度：2560px 输出上限、1–16px 网点、2–32 阶色阶，低色阶加 Bayer 抖动。
- 2.0.157 图片像素画化新增“明暗度”调节（-100～+100），负值压暗、正值提亮，聊天图片和背景共用。
- 2.0.158 图片像素画化改用 Folia 的 ImageDithering（8×8 Bayer、暗底浅点、3px/4阶默认），并新增“深色底”开关。
- 2.0.159 角色卡列表改为页内滚动，并新增 10/20/50 每页 + 上一页/下一页分页条。
- 版本号升至 `2.0.159`，保留原有旧 loader 与更新日志。
- 增加本声明与 README 顶部的原作者说明。

除上述改动外，其余代码、样式、文案和更新日志均来自原仓库。

## 授权说明 / License

**原仓库没有附带 LICENSE 文件。** 本仓库不会、也不能替原作者授予任何额外许可；原代码的全部权利仍归原作者 lulu 所有。

本 fork 仅用于个人使用、测试和兼容性修复，按“现状”提供，不附带任何明示或暗示的担保。若原作者认为本仓库不合适，或要求删除，维护者会在收到通知后删除本仓库及相关发布物。

如果你要商业使用、二次分发或基于本代码发布自己的版本，请先联系原作者取得授权。

---

## English summary

This is an unofficial fork of **Claude Web 2.0** by **lulu** (<https://github.com/claudenoshujin/claude-web>), maintained by **suyi1379-droid** (<https://github.com/suyi1379-droid>). It is not affiliated with or endorsed by the original author. The original repository does not include a license file; this fork grants no additional rights to the original code, and all rights remain with the original author. The fork is provided as-is for personal use and compatibility fixes. If the original author requests removal, it will be taken down.
