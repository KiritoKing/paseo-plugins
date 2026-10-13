# 浏览器行为验证页面

此页面调用实际图片聚合模块，提供默认折叠、流式追加、历史重建、相邻消息行、暗色主题和卸载恢复的测试入口。

在仓库根目录：

```sh
mkdir -p work/browser
cp tests/browser/fixture.html work/browser/
node_modules/.bin/esbuild tests/browser/fixture.ts --bundle --outfile=work/browser/fixture.js --alias:react-native=./tests/browser/native-stub.ts
python3 -m http.server 8769 --bind 127.0.0.1 --directory work/browser
```

用浏览器打开 `http://127.0.0.1:8769/fixture.html`。默认第一组 5 张显示 3 张，第二组 1 张。展开后追加图片，总数变成 6 并保留展开。重建历史行后也应保持展开。分散消息行应显示 2 张与 1 张两组，中间由工具输出隔开。卸载后应出现原生图片按钮。

这是独立测试页，不能替代在 Paseo 中验收真实媒体面板和预览弹窗。Python 3 仅用于可选测试服务；macOS 可使用系统 Python，Linux 使用发行版包管理器安装，Windows 使用 python.org。缺少 Python 时可使用已有的本地静态文件服务器。

## 快捷键与大图手势

```sh
mkdir -p work/browser/h/fixture-host/workspace/fixture-workspace
cp tests/browser/controls.html work/browser/h/fixture-host/workspace/fixture-workspace/index.html
node_modules/.bin/esbuild tests/browser/controls.ts --bundle --outfile=work/browser/controls.js --alias:react-native=./tests/browser/native-stub.ts
```

使用上面的本地服务，打开 `http://127.0.0.1:8769/h/fixture-host/workspace/fixture-workspace/`。真实鼠标滚轮缩放、拖拽移动、双击复位。页面按钮派发两个组合键，原生模拟监听器在窗口捕获阶段先执行，计数应分别为恢复一次、终端一次。卸载后恢复组合键应重新触发原生终端。新建菜单应出现恢复入口。

菜单验证使用原生 MenuItem 的图标槽、文字槽和快捷键槽布局。恢复行应插入 Agent 后面，与相邻行字体、图标、间距一致；Terminal 提示变为 Ctrl+反引号。恢复行聚焦后 Enter/空格选择应只触发一次，卸载后恢复原提示。

## 独立恢复页面上下文回归

```sh
mkdir -p work/browser
cp tests/browser/session-screen.html work/browser/
node_modules/.bin/esbuild tests/browser/session-screen.jsx --bundle --outfile=work/browser/session-screen.js --alias:react-native=./tests/browser/screen-native.jsx --alias:@getpaseo/plugin/client/react-native=./tests/browser/screen-ui.jsx
```

使用本地服务打开 `http://127.0.0.1:8769/session-screen.html`。此夹具用项目本地 React DOM 运行实际 `SessionHistory` 和 Paseo SDK RPC 上下文，刻意不提供仅面板具备的状态上下文。点击“打开会话选择”应在原工作区上显示 Modal；搜索“之前”后剩一个关闭会话，选择后关闭并在下方记录正确的 RPC 参数和打开 ID。Escape、关闭按钮取消后原 URL 和工作区草稿应保留。“恢复最近关闭”验证快速恢复；“迁移旧全页入口”验证回到工作区后弹窗选择。UI 原语和 RPC 数据为模拟，仅验证组件运行契约，不修改真实会话。

若恢复页再次使用面板状态钩子，会直接显示原始 `Plugin state hooks must run inside a workspace panel` 错误。所有 `/client/host` 引用只出现在测试宿主中，不进入插件生产代码。

## 大图方向键切换

```sh
mkdir -p work/browser
cp tests/browser/image-navigation.html work/browser/
node_modules/.bin/esbuild tests/browser/image-navigation.jsx --bundle --outfile=work/browser/image-navigation.js --alias:react-native=./tests/browser/screen-native.jsx --alias:@getpaseo/plugin/client/react-native=./tests/browser/image-ui.jsx
```

使用本地服务打开 `http://127.0.0.1:8769/image-navigation.html`。该夹具用三张合成图片和模拟 UI 原语运行实际 `ImagePreview`：打开大图后左右键切换，按钮“连续右键”在同一事件内派发五次按键，最终应停在第三张。首尾方向键保持当前缩放，成功切图则复位；输入框和 Shift 组合键不切图。“同时打开两个弹窗”验证前方弹窗阻止背景切图，关闭前方弹窗后恢复。关闭预览后按键计数增加，验证监听器释放。“隐藏测试控件”便于查看产品布局。
