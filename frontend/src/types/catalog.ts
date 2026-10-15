export type Kind = "customers" | "products" | "projects";
export type Contact = {
  name: string;
  gender: "male" | "female" | "other" | "unspecified";
  position: string;
  methods: { type: string; value: string }[];
  notes: string;
};
export type CatalogRecord = {
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_by_name?: string | null;
  id: string;
  display_name: string;
  created_by: string;
  updated_by: string;
  created_by_name: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
  revision: number;
  company_name?: string;
  country_code?: string;
  country_name?: string;
  city_id?: string;
  city_name?: string;
  level?: string;
  contacts?: Contact[];
  notes?: string;
  type?: string;
  model?: string;
  chipset?: string;
  system?: string;
  repository_url?: string;
  number?: string;
  pm?: string;
  start_month?: string;
  stage?: string;
  customer_id?: string;
  product_id?: string;
  customer_name?: string;
  product_name?: string;
};
export type CatalogPage = { items: CatalogRecord[]; total: number };
export type Option = { value: string; label: string; region?: string };
export const labels: Record<Kind, string> = {
  customers: "客户库",
  products: "产品库",
  projects: "项目库",
};
