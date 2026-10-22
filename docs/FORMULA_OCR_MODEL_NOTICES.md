# 本地公式识别运行时

当前开发候选使用 **Pix2Text-MFR-1.5 ONNX CPU**，取代旧RapidLaTeXOCR模型。候选是否已经安装，以[当前交付记录](tests/2026-10-20-final-delivery.md)为准。

## 模型来源与许可

- 模型作者：Breezedeus / Pix2Text。
- 官方模型卡：[breezedeus/pix2text-mfr-1.5](https://huggingface.co/breezedeus/pix2text-mfr-1.5)，标注MIT。
- 固定资源版本：`1cef9f0bdcd6a4c63df7de1311fb0894593340cc`。模型卡说明其基于微软TrOCR架构重新训练；Lattice不声称拥有模型权重。
- [Pix2Text源代码与许可证](https://github.com/breezedeus/Pix2Text)。产品运行时直接使用固定ONNX和tokenizer资源，不自动执行模型仓库的Python代码，也不安装完整Pix2Text、Torch或Optimum。
- 本托管包共20项静态资源，下载总量178,433,415字节（约171MiB）；资产来源、版本、大小、SHA256及依赖许可证保存在 `src-tauri/src/formula-ocr-runtime-manifest.json`。Python/ONNX Runtime/NumPy/Pillow/tokenizers及依赖保留各发行包自带的许可文件。

## 执行与隐私

图片只在本机处理，不调用在线模型、在线演示或付费识别服务。Python嵌入式环境安装在应用专属目录；下载资源校验后解压，不修改系统Python或PATH。新运行时使用独立ID，旧版目录保留；已校验的同hash依赖可复用缓存。

识别进程运行时关闭Python网络socket连接。这个限制不等于任意Python代码的操作系统沙箱；只加载固定hash的引擎和数据，不允许远端自定义代码。PDF/插件调用在主程序中继续检查文档身份、选区、取消状态和结果大小。

## 结果边界

默认输出始终待校对。语法可渲染不表示符号、字体或数学语义正确；粗体可能表示向量，不能自动删掉。原图、原始识别和当前编辑稿分别保存；编辑不覆盖原始预测。错误语法或未完整结束的初稿不能作为普通完成稿复制/导出。

生成器总序列上限1024 token（包含起始token），并输出真实EOS、token数和截断状态；不会伪造结束标志。预处理保留整个截图，按固定DeiT配置缩放至384×384、RGB白底、归一化到[-1,1]。没有使用数学含义猜测修正`x/α`、矩阵元素、行列或粗体。

72项合成比较显示比旧模型改善，但有字体误认、3×3矩阵多余空结构等残余错误。这不是通用OCR准确率承诺；扫描噪声、复杂真实文档仍需原图核对。纯文本/Word/MathML原有提取不依赖该图像模型，Web图片OCR仍需要桌面本地运行时。
