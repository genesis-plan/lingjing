# GitHub 仓库被使用情况体检（2026-09-14）

> 数据截止说明：GitHub Traffic 滞后约 2 天，本批数据覆盖至 **2026-09-12**（抓取于 2026-09-14 04:04 UTC）。
> npm 下载同理，区间尾部 09-13/09-14 为「未回填」显示 0，**有效数据截止到 09-12**。
> 原始逐日数据见同目录 `2026-09-14-github-usage-raw.json`。

## 一、总览

| 仓库 | 默认分支 | pushed_at | stars | forks | clones(总/独立) | views(总/独立) | license |
|---|---|---|---|---|---|---|---|
| genesis-plan/lingnao | main | 2026-09-04 | 0 | 0 | 166 / 65 | 31 / 9 | NOASSERTION |
| genesis-plan/lingshu-solver | master | 2026-09-07 | 0 | 0 | 519 / 157 | 26 / 11 | NOASSERTION |
| genesis-plan/lingjing | main | 2026-09-04 | 0 | 0 | 13 / 9 | 0 / 0 | 无 |

## 二、流量明细

### lingnao（灵脑）
- clones 逐日：08-31=62、09-03=54、09-02=23、09-04=7、09-05=3…，其余个位数或 0。views 峰值 08-31=18。
- referrers：github.com=16（占 94%）、Bing=1。paths Top：Overview=21、releases/tag/v1.0.0=3、tags/tree/commit 各 1~2。
- 峰值与发版日重合（v1.0.0 08-30、v1.1.0 09-03、v1.1.1 09-04）→ 发版日批量拉取，典型索引行为。

### lingshu-solver（灵数）
- clones 逐日：**09-01=243（70 独立）**、08-31=73（22u）、09-07=61（25u）、09-04=27、09-03=20…，其余个位数。
- views 峰值仅 08-31=7；referrers **只有 github.com=8**；paths Top：Overview=23，branches/commit/tags 各 1。
- 09-01 单日 243 clones / 70 独立来源是明显异常尖峰——更像某索引/聚合器批量拉取，而非散点真人。

### lingjing（灵境）
- 仅 09-04 建仓当天 9 clones，之后零星 1 次/天，views=0，无 referrers/paths。
- ⚠️ GitHub 上的 lingjing 只有 **2026-09-04 的初始提交**；人判契约的全部本地改动**尚未推送**，故线上流量不反映新工作。

## 三、npm 下载（lingshu-solver）
- 已发布：1.0.0–1.0.8（latest 1.0.8，2026-09-07）。
- 区间 2026-01-01→09-14，首条非零在 **2026-08-25**（发版次日）；**累计 ≈ 872 次**。
- 尖峰全落在发布日附近：08-25=353、09-01=152、09-04=154；非发布日多为 0 或个位数~三十几（08-28=28…09-12=12）。
- 判读：尖峰＝发布工具链/registry 传播；非发布日小量是 CI 或零星 `npx` 调用，**无法确认是真人安装**。

## 四、诚实判读：被索引 / 被扫，还是被使用？
统一信号：**clones ≫ views，referrers 几乎只有 github.com，0 stars / 0 forks**。
→ 按体检口径，这是「被索引 / 被扫描」的特征，**不是真人使用**。
- lingnao：发版日批量拉取，典型索引行为。
- lingshu-solver：pull 量最大（519/157u），且有 09-01 异常尖峰；157 个独立来源比另两个多，但缺 UA/服务端证据，**不能据此认定真人使用**——更可能是 MCP 聚合器 / Awesome 列表 / 扫描器在抓。
- lingjing：基本无外部流量（且线上代码陈旧）。
- 真正能区分「被索引 vs 被使用」的**最硬证据是部署服务端 `calls.log`**（MCP 真实调用记录）。本批未取（需 SSH 腾讯云 159.75.154.206 读 `/opt/lingshu` 日志）。如需，我可下一步去取。

## 五、问题清单
- 🟡 **lingjing 仓库线上陈旧**：人判契约改动未推送，GitHub 流量不反映现状。→ 待你拍板是否提交推送。
- 🟡 **本地 `.git/config` 的 remote URL 内联了 GitHub PAT**（`https://genesis-plan:ghp_…@github.com/…`，本次 `git remote -v` 可见）。目录被压缩/分享即泄漏。属用户既有设置（credentials.md 也记录了同样内联），列为加固项，**不擅自改**。
- 🟢 三仓库 **0 stars / 0 forks**：当前无任何社区采用信号。
- 🟢 本次未查 Actions CI（流量体检范围）；如需可补。

## 六、AI 已决 / 待您拍板
- **AI 已决**：拉取三个仓库真实 Traffic + npm 下载，产出本报告（原始数据见 `2026-09-14-github-usage-raw.json`）。未做任何推送/修改、未触碰远端。
- **待您拍板**：
  1. 是否提交并推送 lingjing 人判契约改动（否则线上不反映）。
  2. 是否去腾讯云服务器取 `calls.log` 做「被使用」最硬核验。
  3. 是否加固 git remote（去掉内联 token，改走 credential helper / SSH）。
  4. 是否补查三仓库 Actions CI 状态。
