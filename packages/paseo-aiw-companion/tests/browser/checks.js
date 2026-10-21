// Runs against the production components, using only DOM interactions and RPC readback.
export async function runChecks() {
  const passed = [];
  const frame = () => new Promise((resolve) => setTimeout(resolve, 30));
  const waitFor = async (predicate) => {
    for (let i = 0; i < 50; i++) {
      if (predicate()) return;
      await frame();
    }
    throw new Error("Timed out waiting for UI");
  };
  const find = (label) => document.querySelector(`[aria-label="${label}"]`);
  const button = (text) =>
    [...document.querySelectorAll("button")].find((node) => node.textContent === text);
  const click = async (label) => {
    const node = find(label) ?? button(label);
    if (!node) throw new Error(`Missing ${label}`);
    node.click();
    await frame();
  };
  const fill = async (label, text) => {
    const input = find(label);
    const proto =
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await frame();
  };
  const trace = () => JSON.parse(document.querySelector("#trace").textContent || "[]");
  const assert = (condition, name) => {
    if (!condition) throw new Error(name);
    passed.push(name);
  };
  const search = async (text) => {
    const normalized = text.trim();
    const requestsBefore = trace().filter((item) => item.method === "aiw.search").length;
    await fill("搜索文本", text);
    find("搜索文本").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => {
      const requests = trace().filter((item) => item.method === "aiw.search");
      if (requests.length <= requestsBefore) return false;
      const latest = requests.at(-1);
      if (latest?.input.query !== normalized || document.body.textContent.includes("正在跨仓搜索…"))
        return false;
      if (text === "empty") return document.body.textContent.includes("没有匹配结果");
      if (text === "error") return document.body.textContent.includes("无效的正则表达式");
      if (text === "partial")
        return (
          document.body.textContent.includes("结果已截断") &&
          document.body.textContent.includes("仓库不可读取")
        );
      return !!find("打开 前端 src/main.ts 第 42 行");
    });
  };
  await waitFor(() =>
    document.querySelector("#registration").textContent.includes("1 个面板 · 1 个入口"),
  );
  assert(
    document.querySelector("#registration").textContent.includes("1 个面板 · 1 个入口"),
    "single AIW panel and header",
  );
  assert(
    find("搜索配置").getAttribute("aria-expanded") === "false" && !find("搜索 include 路径"),
    "advanced options collapsed initially",
  );
  await search(" \tneedle \t");
  assert(
    trace()
      .filter((item) => item.method === "aiw.search")
      .at(-1).input.query === "needle",
    "Enter submits a trimmed query",
  );
  const maxQuery = "x".repeat(256);
  await fill("搜索文本", ` ${maxQuery} `);
  assert(
    !find("搜索").disabled && !document.body.textContent.includes("搜索文本最多 256 个字符"),
    "padded 256-character query is enabled without a length warning",
  );
  await click("搜索");
  await waitFor(
    () =>
      trace()
        .filter((item) => item.method === "aiw.search")
        .at(-1)?.input.query === maxQuery && !document.body.textContent.includes("正在跨仓搜索…"),
  );
  assert(
    trace()
      .filter((item) => item.method === "aiw.search")
      .at(-1).input.query === maxQuery,
    "search button submits a trimmed 256-character query",
  );
  for (const [text, name, warning] of [
    [` ${"x".repeat(257)} `, "257-character query is blocked for button and Enter", true],
    [" \t ", "whitespace-only query is blocked for button and Enter", false],
  ]) {
    await fill("搜索文本", text);
    const before = trace().filter((item) => item.method === "aiw.search").length;
    find("搜索文本").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await frame();
    assert(
      find("搜索").disabled &&
        document.body.textContent.includes("搜索文本最多 256 个字符") === warning &&
        trace().filter((item) => item.method === "aiw.search").length === before,
      name,
    );
  }
  await search(" needle value ");
  assert(
    trace()
      .filter((item) => item.method === "aiw.search")
      .at(-1).input.query === "needle value",
    "query normalization preserves internal whitespace",
  );
  await search("needle");
  assert(
    trace()
      .filter((x) => x.method === "aiw.search")
      .at(-1)
      .input.repoIds.join(",") === "web,api",
    "only ready repositories searched by default",
  );
  assert(
    !!find("打开 前端 src/main.ts 第 42 行") && !!find("打开 服务端 src/main.ts 第 42 行"),
    "results grouped across repositories",
  );
  await click("打开 前端 src/main.ts 第 42 行");
  assert(
    trace()
      .filter((x) => x.method === "aiw.file")
      .at(-1).input.startLine === 42,
    "search hit opens line 42 in shared reader",
  );
  await click("文件");
  await waitFor(() => !!find("打开 src/main.ts"));
  assert(!!find("打开 src/main.ts"), "file tree ancestors expanded after search hit");
  await click("改动");
  assert(document.body.textContent.includes("对比范围"), "business diff view retained");
  await click("搜索结果");
  await click("搜索配置");
  await click("区分大小写");
  await click("使用正则表达式");
  await fill("搜索 include 路径", "**/*.ts\n**/*.tsx");
  await fill("搜索 exclude 路径", "**/generated/**");
  await click("服务端");
  await click("搜索配置");
  assert(
    document.body.textContent.includes("已启用搜索范围限制"),
    "collapsed active filters remain visible",
  );
  await search("needle");
  const request = trace()
    .filter((x) => x.method === "aiw.search")
    .at(-1).input;
  assert(
    request.regex &&
      request.caseSensitive &&
      request.repoIds.join(",") === "web" &&
      request.include.length === 2 &&
      request.exclude[0] === "**/generated/**",
    "advanced options transmitted together",
  );
  const count = trace().filter((x) => x.method === "aiw.search").length;
  await click("搜索");
  assert(
    trace().filter((x) => x.method === "aiw.search").length === count + 1,
    "same query is refreshed when submitted again",
  );
  await click("清除搜索");
  assert(!button("搜索结果") && !!find("显示忽略文件"), "clear search restores file tree");
  await search("empty");
  assert(document.body.textContent.includes("没有匹配结果"), "empty results visible");
  await search("error");
  assert(document.body.textContent.includes("无效的正则表达式"), "search RPC error visible");
  await search("partial");
  assert(
    document.body.textContent.includes("结果已截断") &&
      document.body.textContent.includes("仓库不可读取"),
    "partial failure and truncation visible",
  );
  await click("搜索配置");
  await click("前端");
  assert(
    find("搜索").disabled && document.body.textContent.includes("请选择至少一个可用仓库"),
    "empty repository selection blocks search",
  );
  await click("全部可用仓库");
  await click("搜索配置");
  await click("清除搜索");
  await click("搜索命令");
  assert(
    document.activeElement === find("搜索文本"),
    "search command focuses existing panel input",
  );
  await click("切换主题");
  await click("切换宽度");
  assert(
    document.querySelector('[data-testid="aiw-split-layout"]').getBoundingClientRect().width <= 340,
    "compact dark panel fits narrow width",
  );
  await click("搜索配置");
  assert(
    find("搜索 include 路径").getBoundingClientRect().right <= 341,
    "advanced fields fit compact width",
  );
  await click("面板名称设置");
  await fill("AIW Tab 名称", "   ");
  await click("保存 Tab 名称");
  assert(document.body.textContent.includes("请输入 Tab 名称"), "blank custom title rejected");
  await fill("AIW Tab 名称", "我的 AIW");
  await click("保存 Tab 名称");
  assert(document.body.textContent.includes("已保存"), "custom title saved");
  await click("重载插件");
  await waitFor(() =>
    document.querySelector("#registration").textContent.includes("我的 AIW · 1 个面板 · 1 个入口"),
  );
  assert(
    document.querySelector("#registration").textContent.includes("我的 AIW · 1 个面板 · 1 个入口"),
    "custom title read on reload without duplicate registration",
  );
  await click("面板名称设置");
  await click("搜索命令");
  assert(document.activeElement === find("搜索文本"), "search focus works after remount");
  return { passed: passed.length, checks: passed };
}
