# 应用管理的本地公式识别

本模块当前开发源码使用固定版本的 Pix2Text-MFR-1.5 / ONNX Runtime CPU 引擎，不调用对话模型或云端识别服务。首次从公式提取面板明确启用后，下载清单 `src-tauri/src/formula-ocr-runtime-manifest.json` 中的20份资源（178433415字节，约171MiB），解压后占用更多磁盘空间。Windows x64使用独立Python 3.11.9，不修改全局Python或PATH。其他平台不显示可执行安装入口。实际安装交付状态以[交付记录](../tests/2026-10-20-final-delivery.md)为准；旧RapidLaTeXOCR目录不覆盖。

## 安装与取消

安装位于应用数据目录 `formula-ocr/pix2text-mfr-1.5-win-x64-r1/`，诊断profile与用户profile分开。每份下载校验固定长度和SHA256，完成资源保留作重试缓存；提取到私有临时目录，经真实CPU模型加载检查后提交。未完成或损坏安装不能当作可用；重试不得覆盖用户文档。安装和取消在发送前绑定同一UUID，取消未获原生确认不会假报完成；窗口关闭仅影响该窗口任务。

运行时的Python、模型、依赖及runner都有完整性核对。公式图片通过本机临时PNG交给引擎，推理时禁止Python网络连接，不会自动联网补下载模型。引擎为第三方代码而非系统级沙箱；不向其传递账号密钥或其他文档。

## 能力与质量

原生文本PDF公式提取继续使用文档结构，本模块专门补图片公式。模型结果必须标为待校正，使用与复制同一可编辑LaTeX，保留原图/原预测。新模型改善已知根号、2×2矩阵与多行对齐；72项合成比较仍有粗体/正体误认和3×3多余空结构，不能把非空输出、符号序列相同或语法可渲染当作数学正确。完整限制见[模型与结果说明](../FORMULA_OCR_MODEL_NOTICES.md)。

## 依赖与许可

下载地址、精确版本、长度及SHA256固定在资源清单，使用官方Python/PyPI及模型作者HuggingFace固定commit，不使用浮动分支资源。各wheel内的原始LICENSE、METADATA和NOTICE随解压保留，不删除或改写。主要许可：

- Python嵌入式运行时：Python-2.0；原包含LICENSE。
- Pix2Text-MFR-1.5模型及tokenizer：官方模型卡MIT；固定revision保留来源，不宣称训练数据权利全部证明。
- ONNX Runtime、coloredlogs、humanfriendly等：各自MIT或原wheel许可。
- NumPy/SymPy/mpmath/protobuf：各自BSD类声明，保留原通知和二进制依赖声明。
- tokenizers：Apache-2.0及依赖声明。
- Pillow：MIT-CMU。新运行时不再包含RapidLaTeXOCR、OpenCV、requests、chardet等旧识别依赖；旧隔离目录保持原样。

官方来源：[Pix2Text-MFR-1.5](https://huggingface.co/breezedeus/pix2text-mfr-1.5)、[Python 3.11.9](https://www.python.org/downloads/release/python-3119/)。打包者变更依赖版本时必须重建资源和已安装文件清单，不能仅改版本号后跳过实际CPU安装验收。
