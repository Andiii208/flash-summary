# ASR 网关时间戳能力探测报告（批次 1.1）

- 日期：2026-09-04
- 探测对象：小米 MiMo 网关 `https://api.xiaomimimo.com/v1`，模型 `mimo-v2.5-asr`（真实库 capability_bindings 的 asr 绑定）
- 性质：**只读探测**——产品代码零改动；api key 全程内存解密、不打印不落盘（借安装版 userData 的 Local State 经 SEU_PROBE_USER_DATA 缝解封，见 PROGRESS 关键决定记录）
- 结论速览：**❌ 不支持 segment 级时间戳，且协议层禁止模型侧时间戳输出 → 条件批次 1.2 取消，维持 120s 分片粒度**

## 一、动机

120 秒分片起点是全部时间相关功能的精度天花板（note-craft SKILL §8 第一条）：timeline 引用、就近配图 90s 容差、QA 时间点引用都受制于此。本探测回答唯一问题：网关能否给出分片内的真实偏移（segment 级时间戳）。

## 二、探测方法

1. **已知内容音频**：Windows SAPI（Microsoft Huihui zh-CN，Rate −2）合成 5 句中文，每句经 ffmpeg `apad=whole_dur=20` 精确补齐为 20s，concat 成 **100s · 16kHz · mono · wav**。段起点先验已知：0 / 20 / 40 / 60 / 80s。
2. **传输**：Electron main 内以 **Node `https.request`** 直发（不用全局 fetch——Electron main 的 fetch 走 Chromium 网络栈，实测 `AbortSignal.timeout` 不生效会永久挂起，本探测第一次跑即因此卡死 30 分钟）。
3. **矩阵**：5 个探测（下表），每个硬超时 240s。

## 三、探测矩阵与结果

| # | 请求形态 | 状态 | 耗时 | 结论 |
|---|---|---|---|---|
| A | multipart `POST /audio/transcriptions` + `response_format=verbose_json` + `timestamp_granularities[]=segment`（20s 片） | **404** | 235ms | 端点不存在（openresty），复证 V1 时期「MiMo 无 multipart ASR」的校准 |
| B | chat/completions + `input_audio`（100s，纯音频 content）——**产品现行 fallback 路径** | **200** | 2856ms | 转写正确（五句全对），但响应**无任何时间戳结构**（见样例 1） |
| C | B + 追加 text part 要求输出 `{"segments":[{"at",…}]}` | **400** | 527ms | **被网关明确拒绝**（见样例 2） |
| D | C + `response_format: {type:'json_object'}` | **400** | 660ms | 同上，json_object 不改变拒绝 |
| E | chat 请求体混入 OpenAI transcription 参数（`response_format:'verbose_json'`、`timestamp_granularities`） | **500** | 343ms | 网关不静默忽略，直接内部错误 |

### 样例 1（B，成功响应的骨架）

```json
{"id":"…","choices":[{"finish_reason":"stop","message":{
  "content":"第一句，今天我们开始讨论数据结构的基础概念，包括线性表和树。第二句，…第五句，图结构用顶点和边表示对象之间复杂的关系网络。",
  "role":"assistant","audio":null,"tool_calls":null,"audio_tokens":[]}}],
 "model":"mimo-v2.5-asr","usage":{…}}
```

content 为整段拼接纯文本；无 `segments`/`words`/`verbose` 任何变体字段。转写内容与合成脚本逐句吻合（验证音频与链路有效）。

### 样例 2（C/D，400 的完整错误——最有信息量的一条）

```json
{"error":{"code":"400","message":"Param Incorrect",
 "param":"ASR request must not include text parts; text prompt is injected by the gateway","type":""}}
```

两个含义：①客户端**无法**在 ASR 请求中附加任何文本指令；②ASR 的文本 prompt 由网关侧注入——「让模型顺便输出时间戳」的路从协议层被封死，而非仅是模型不配合。

### 样例 3（A，404）

```html
<html><head><title>404 Not Found</title></head>
<body><center><h1>404 Not Found</h1></center><hr><center>openresty</center></body></html>
```

## 四、结论与处置

1. **MiMo 网关（mimo-v2.5-asr）不支持 segment 级时间戳**：transcriptions 端点不存在（A）、chat 路径无时间戳返回结构（B）、客户端无法注入指令让模型输出时间戳（C/D）、参数级协商也不被接受（E）。五条路全断，无变通余地。
2. **条件批次 1.2（转写分段级时间戳）按计划兜底取消**——维持 120s 分片起点粒度；`NEAREST_SECONDS` 不收紧（保持 90）。三层证据对齐（ref 精确匹配 → 就近关键帧 → 纯文字）已验证可用，精度天花板记录于 note-craft SKILL §8 不再重复探测。
3. 附带档案价值：样例 2 揭示的「text prompt injected by the gateway」解释了 MiMo ASR 的行为面——未来若 MiMo 更新出时间戳能力，重跑本矩阵即可（脚本形态见探测会话记录，不入库）。

## 五、探测现场备注

- 探测在 **Clash TUN 关闭（直连）** 下进行；TUN 开启时 provider 大请求会挂起（批次 2.1 现场结论，PROGRESS 有案）。
- 网关对 E 类畸形请求返回 500 而非 400/忽略——重试无害，但提示不要向该网关发送任何实验性参数。
