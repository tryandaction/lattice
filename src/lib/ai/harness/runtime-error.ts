/** Keep the service's concrete reason while explaining the recovery path. */
export function describeHarnessFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/selected model|model.{0,60}(?:does not exist|not found|no access|not available)/iu.test(message)) {
    return `所选助手的模型服务拒绝了当前模型。请在模型菜单选择可用模型；若原助手设置了模型别名或转发服务，请检查原配置。已保留对话和原问题。\n${message}`;
  }
  return message;
}
