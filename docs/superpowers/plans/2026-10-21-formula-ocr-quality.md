# 公式OCR精度与校正链路

状态：in_progress。上一轮已安装3.1.0；本项候选未交付。

## 目标

解决公式插件现有根号字符混淆、矩阵和多行结构损坏，保留用户原始截图及可校正结果；区域公式可直接进入OCR，复制/导出与屏幕上的修订版本一致。界面保持简洁。只使用合成文件及公开模型静态下载，不调用真实API/CLI模型，不读取用户论文。

## 证据与执行顺序

1. completed：复核六例已知失败及七种无通用收益的预处理，确认根号/矩阵错误直接来自旧模型。新候选Pix2Text-MFR-1.5在官方固定commit下载，ONNX权重SHA256与官方LFS一致，代码/权重许可MIT；纯CPU初步六例恢复根号、2×2矩阵和对齐结构，不能用字符完全一致计数衡量等价格式。
2. completed（对照评估，非准确率完全达标）：72图新旧模型及生产runner重放；根号/2×2矩阵/多行结构改善，字体和3×3空结构失败明确保留，独立审查完成。详见 `.lattice-build/turn-20261021/ocr-quality-audit.md`。
3. completed（离线安装）：20项178433415bytes固定资产；3241文件完整清单及hash，独立运行时ID。缓存安装、取消、损坏修复实际通过；Python 7项假decoder/图片边界测试通过，真实72图全部EOS、无异常特殊token、无截断。旧运行时不覆盖。
4. completed：插件/PDF严格安全渲染共用helper；错误矩阵、外部资源和宏污染15项红测试后绿；正常编辑器行为保留。
5. completed（专项）：保留原图/原始预测/初始兼容稿/当前修订；不可变截断元数据及改后撤销保护，插件/PDF均提示校正。高清单页区域入口、exact/imageBbox分离、文档/版本/token校验；真实合成扫描图像素回归通过。切文件旧结果不再禁新OCR；安装取消绑定当前UUID并检查原生ACK。
6. in_progress：整合专项258项、类型检查通过；独立审查发现P2已补。冻结后完整门禁、安装版合成回归、网页更新并逐字节核对偏好与凭据。

## 官方依据

- [MFR-1.5模型卡](https://huggingface.co/breezedeus/pix2text-mfr-1.5)：本地ONNX、TrOCR/DeiT预处理和生成参数，权重标注MIT。固定revision `1cef9f0bdcd6a4c63df7de1311fb0894593340cc`。
- [KaTeX选项](https://katex.org/docs/options)：不可信输入关闭trust，throwOnError启用，maxExpand/maxSize限制；共享宏需复制隔离。
- PaddleOCR PP-FormulaNet也已查阅官方模型表；其CPU/依赖部署路径更重，当前先评估可复用既有ONNX CPU运行时的MFR模型，任何替换均以本地实测为准。

## 待办板

仅发布整合处于in_progress。安全渲染与取消链路由原OCR审查代理实现、PDF区域由PDF代理实现，主线负责模型、工作流及发布收敛；所有修改已停止扩范围。
