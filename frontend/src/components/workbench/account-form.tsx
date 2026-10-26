"use client";

import type { Dispatch, SetStateAction } from "react";
import { CatalogCombobox } from "@/components/catalog/catalog-ui";
import { SearchSelect } from "@/components/catalog/search-select";
import { Checkbox } from "@/components/ui/base/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/base/field";
import { Input } from "@/components/ui/base/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/base/native-select";
import { useUiTranslations } from "@/i18n/client";
import { systemMessage } from "@/i18n/system-messages";
import type { Account } from "@/types/workbench";
import type { MailOverview } from "@/types/workbench-mail";
import { type AccountDraft, platforms } from "./settings";

export function AccountForm({
  account,
  onChange,
  errors,
  accountError,
  projectLabels,
  setProjectLabels,
  mailData,
}: {
  account: AccountDraft;
  onChange: (value: AccountDraft) => void;
  errors: Record<string, string>;
  accountError?: string | null;
  projectLabels: Record<string, string>;
  setProjectLabels: Dispatch<SetStateAction<Record<string, string>>>;
  mailData: MailOverview | null;
}) {
  const t = useUiTranslations();
  return (
    <div className="space-y-5">
      {accountError && (
        <p role="alert" className="text-destructive text-sm">
          {systemMessage(accountError, t)}
        </p>
      )}
      <Field>
        <FieldLabel htmlFor="workbench-field-8">
          {t("ui.customerAccountName")}
        </FieldLabel>
        <Input
          id="workbench-field-8"
          aria-invalid={!!errors["workbench-field-8"]}
          aria-describedby={
            errors["workbench-field-8"] ? "workbench-field-8-error" : undefined
          }
          value={account.name}
          onChange={(e) => onChange({ ...account, name: e.target.value })}
        />
        {errors["workbench-field-8"] && (
          <FieldError id="workbench-field-8-error">
            {errors["workbench-field-8"]}
          </FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="workbench-field-9">{t("ui.platform")}</FieldLabel>
        <NativeSelect
          id="workbench-field-9"
          value={account.platform}
          onChange={(e) =>
            onChange({
              ...account,
              platform: e.target.value as Account["platform"],
            })
          }
        >
          {Object.entries(platforms)

            .map(([k, v]) => (
              <NativeSelectOption key={k} value={k}>
                {v}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="workbench-field-10">
          {t("ui.httpsSiteRootUrl")}
        </FieldLabel>
        <Input
          id="workbench-field-10"
          aria-invalid={!!errors["workbench-field-10"]}
          aria-describedby={
            errors["workbench-field-10"]
              ? "workbench-field-10-error"
              : undefined
          }
          value={account.base_url}
          placeholder="https://jira.example.com"
          onChange={(e) => onChange({ ...account, base_url: e.target.value })}
        />
        {errors["workbench-field-10"] && (
          <FieldError id="workbench-field-10-error">
            {errors["workbench-field-10"]}
          </FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="workbench-field-11">{t("ui.username")}</FieldLabel>
        <Input
          id="workbench-field-11"
          aria-invalid={!!errors["workbench-field-11"]}
          aria-describedby={
            errors["workbench-field-11"]
              ? "workbench-field-11-error"
              : undefined
          }
          autoComplete="off"
          value={account.username}
          onChange={(e) => onChange({ ...account, username: e.target.value })}
        />
        {errors["workbench-field-11"] && (
          <FieldError id="workbench-field-11-error">
            {errors["workbench-field-11"]}
          </FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="workbench-field-12">
          {account.platform === "youtrack"
            ? t("ui.permanentAccessToken")
            : t("ui.passwordAuthorizationCode")}
        </FieldLabel>
        <Input
          id="workbench-field-12"
          aria-invalid={!!errors["workbench-field-12"]}
          aria-describedby={
            errors["workbench-field-12"]
              ? "workbench-field-12-error"
              : undefined
          }
          type="password"
          autoComplete="new-password"
          value={account.password}
          placeholder={
            account.id
              ? t("ui.leaveBlankToKeepCurrentCredentials")
              : t("ui.enterCredentials")
          }
          onChange={(e) => onChange({ ...account, password: e.target.value })}
        />
        {errors["workbench-field-12"] && (
          <FieldError id="workbench-field-12-error">
            {errors["workbench-field-12"]}
          </FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel>{t("ui.project")}</FieldLabel>
        <SearchSelect
          label={t("ui.selectProject")}
          value={account.project_id}
          selectedLabel={
            projectLabels[account.project_id] ?? account.project_id
          }
          url="/api/v1/catalog/projects"
          kind="catalog"
          onChange={(option) => {
            onChange({
              ...account,
              project_id: option.value,
            });
            setProjectLabels((labels) => ({
              ...labels,
              [option.value]: option.label,
            }));
          }}
        />
      </Field>
      <CatalogCombobox
        id="hosting-mail-folder"
        label={t("ui.linkedMailFolder")}
        value={account.mail_folder_id ? [account.mail_folder_id] : []}
        options={(mailData?.folders ?? [])
          .filter((f) => f.selectable)
          .map((f) => ({
            value: f.id,
            label: `${mailData?.mailboxes.find((b) => b.id === f.mailbox_id)?.address} / ${f.path}`,
          }))}
        onChange={(values) =>
          onChange({
            ...account,
            mail_folder_id: values[0] ?? "",
          })
        }
      />
      <p className="text-muted-foreground text-xs">
        {t("ui.monitorNotificationsFromTheLast30DaysInThisFolderAndCollect")}
      </p>
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id="workbench-field-14"
          checked={account.enabled}
          onCheckedChange={(enabled) =>
            onChange({ ...account, enabled: !!enabled })
          }
        />
        <FieldLabel htmlFor="workbench-field-14">
          {t("ui.enableThisPlatform")}
        </FieldLabel>
      </Field>
      <p className="text-muted-foreground text-xs">
        {t(
          "ui.anAdministratorMustAllowThisPlatformHostCredentialsAreEncryptedCollectionReads",
        )}
      </p>
    </div>
  );
}
