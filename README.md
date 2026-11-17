# 泡泡前线 · BubbleFront

一个 QQ 堂（Bomberman 类）玩法的网页 Demo，目标不是复刻，而是把"放泡泡"扩展成
**元素反应 + 区域控制 + 救援协作 + 可验证回放** 的竞技系统。

零依赖：没有框架、没有打包器、没有二进制素材。原生 ES Modules + Canvas 2D + WebAudio。

## 运行

```bash
npm start          # → http://localhost:5173/
```

需要 Node ≥ 18（仅用于静态服务器与测试）。任何静态 HTTP 服务器都能托管本目录，
但必须走 HTTP，不能用 `file://`（ES Modules 限制）。

```bash
npm test                       # 10 个测试：确定性 / 回放 / 元素反应 / AI 自保
node tools/headless.js 42 6000 # 无头跑一局，输出统计与最终哈希
```

## 操作

| 玩家 | 移动 | 放泡泡 | 切换元素 |
| ---- | ---- | ------ | -------- |
| P1 | `W A S D` | `空格` | `E` |
| P2（本地双人） | `方向键` | `回车` | `右 Shift` |

通用：`P` 暂停 · `.` 单步 · `R` 同种子重开 · `H` 爆炸范围预览 · `G` 危险热力图 ·
`M` 静音 · `N` 程序化音乐。工具栏可调 0.25×–4× 速度。

## 三种模式

- **单人 2v2**：你 + AI 队友，对抗两名 AI。
- **四人乱斗**：各自为战，最后存活/最高分获胜。
- **本地双人**：两人同屏组队，对抗两名 AI。

## 超越 QQ 堂的点

1. **五种元素泡泡**：普通 / 焰（烧穿软砖）/ 霜（减速霜面）/ 雷（隔空连锁）/ 毒（可点燃的气域）。
2. **六种元素反应**：爆燃、引信、超导、灭焰、曳光、凝滞，全部由 `data/powers.json` 数据驱动。
3. **两阶段区域**：爆炸格先是要命的热区，再退化为残留区域（霜面、毒气、余烬），
   一次爆破同时是即时威胁与持续封路。
4. **被困 / 救援 / 三条命**：被炸不是直接死，而是困入水泡 5 秒，队友贴身可救；
   敌方也能"赎回"你并得分，形成博弈。
5. **极限冲刺**：爆炸贴着身边炸开却没命中你，奖励短暂加速——鼓励贴脸走位。
6. **输入即回放**：固定 60Hz 整数模拟，回放只存种子 + 人类输入差分（一整局几 KB），
   播放结束逐位校验状态哈希，不一致会明确报出。
7. **同一套 AI 与真人接口**：机器人只产出和人类一样的按键命令，用真实爆炸预测做决策，
   会挖砖、会逃命、会验证"放下这颗泡之后我跑不跑得掉"。
8. **辅助可视化**：落点与爆炸范围预览（调用与真实爆炸同一个 `blastPlan`）、危险热力图。

## 代码结构

```
server.js               零依赖静态服务器
index.html              页面 / HUD / 菜单
data/powers.json        元素、反应、道具的唯一数据源
src/
  core/                 与玩法无关的基础设施
    rng.js              mulberry32，状态存在模拟里
    hash.js             全状态 FNV-1a，回放校验契约
    loop.js             固定步长驱动 + 插值 + 变速
    replay.js           输入差分录制 / 播放 / 校验
  game/                 纯模拟（无 DOM、无定时器、无 Math.random）
    config.js           全部数值调参
    state.js            createSim / stepSim（系统执行顺序）
    input.js            命令位打包与差分编码
    map.js              种子化地图生成
    powers.js           JSON → 规则集
    units.js            定点坐标（256 子单位 = 1 格）
    zones.js            两阶段区域模型
    systems/            movement / bubbles / resolve / ai
  render/               palette / atlas（程序化图集）/ renderer / fx
  audio/sfx.js          全合成音效与芯片风循环
  main.js               浏览器外壳：菜单、输入、HUD、回放
test/                   node:test 测试
tools/headless.js       无头对局与平衡观察
```

## 文档

- [玩法与架构设计](docs/DESIGN.md)
- [素材方案与导出流程](docs/ASSETS.md)

## 调试

浏览器控制台里的 `BF`：`BF.sim` 当前状态、`BF.startMatch(seed, mode, level)`、
`BF.startReplay(json)`、`BF.renderer`（预览/危险图开关）、`BF.atlas`（图集导出）。
