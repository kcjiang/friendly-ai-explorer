import { type CatalogRecord, type Kind } from "@/types/catalog";

export const requiredMessage = "This field is required.";
export const fieldLabels: Record<string, string> = {
  company_name: "Company name",
  country_code: "Country / region",
  level: "Customer tier",
  business: "Business",
  type: "Type",
  model: "Model",
  chipset: "Chipset",
  system: "System",
  repository_url: "Firmware download URL",
  fingerprint: "Project fingerprint",
  number: "Project number",
  pm: "Project manager (PM)",
  fae_id: "FAE",
  start_date: "Start date",
  stage: "Project stage",
  customer_id: "Customer",
  product_id: "Product",
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
        : "Check this field.";
  }
  return errors;
}
