import { type CatalogRecord, type Kind } from "@/types/catalog";

export const requiredMessage = "请填写此字段。";
export const fieldLabels: Record<string, string> = {
  company_name: "公司名",
  country_code: "国家 / 地区",
  level: "客户级别",
  business: "业务",
  type: "类型",
  model: "型号",
  chipset: "芯片",
  system: "系统",
  repository_url: "固件下载地址",
  fingerprint: "项目指纹",
  number: "项目编号",
  pm: "项目经理（PM）",
  fae_id: "FAE",
  start_date: "立项时间",
  stage: "项目阶段",
  customer_id: "客户",
  product_id: "产品",
};
export function requiredErrors(kind: Kind, draft: Partial<CatalogRecord>) {
  const errors: Record<string, string> = {};
  const keys =
    kind === "customers"
      ? ["company_name", "country_code", "level"]
      : kind === "products"
        ? ["type", "model", "chipset", "system"]
        : ["number", "pm", "start_date", "stage", "customer_id", "product_id"];
  keys.forEach((key) => {
    if (!String(draft[key as keyof CatalogRecord] ?? "").trim())
      errors[fieldLabels[key]] = requiredMessage;
  });
  if (kind === "customers")
    draft.contacts?.forEach((contact, ci) => {
      if (!contact.name.trim()) errors[`contact-name-${ci}`] = requiredMessage;
      contact.methods.forEach((method, mi) => {
        if (!method.type.trim())
          errors[`contact-tool-${ci}-${mi}`] = requiredMessage;
        if (!method.value.trim())
          errors[`contact-value-${ci}-${mi}`] = requiredMessage;
      });
    });
  return errors;
}
export function serverFieldErrors(
  detail: { loc?: (string | number)[]; type?: string }[],
) {
  const errors: Record<string, string> = {};
  for (const entry of detail) {
    const path = entry.loc?.filter((part) => part !== "body") ?? [];
    let key = fieldLabels[String(path[0])];
    if (path[0] === "contacts") {
      if (path[2] === "name") key = `contact-name-${path[1]}`;
      else if (path[2] === "methods" && path[4] === "type")
        key = `contact-tool-${path[1]}-${path[3]}`;
      else if (path[2] === "methods" && path[4] === "value")
        key = `contact-value-${path[1]}-${path[3]}`;
    }
    if (key)
      errors[key] = ["missing", "string_too_short"].includes(entry.type ?? "")
        ? requiredMessage
        : "请检查此字段的填写内容。";
  }
  return errors;
}
