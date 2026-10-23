"use client";
import { useUiTranslations } from "@/i18n/client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import FontFamily from "@tiptap/extension-font-family";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/base/button";
import { Input } from "@/components/ui/base/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/base/native-select";
import { normalizeMailLink } from "@/lib/mail-link";

export function MailEditor({
  initial,
  onChange,
}: {
  initial: string;
  onChange: (html: string, text: string) => void;
}) {
  const t = useUiTranslations();

  const [link, setLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const range = useRef({ from: 1, to: 1 });
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TextStyle,
      Color,
      FontFamily,
      Image.configure({ allowBase64: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: initial,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText()),
    editorProps: {
      attributes: {
        class:
          "min-h-40 p-3 outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_a]:text-primary [&_a]:underline [&_img]:max-w-full",
        "aria-label": t("ui.messageBody"),
        role: "textbox",
        "aria-multiline": "true",
      },
    },
  });
  useEffect(() => {
    if (editor) onChange(editor.getHTML(), editor.getText());
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!editor)
    return (
      <p className="text-muted-foreground p-3 text-sm">
        {t("ui.loadingEditor")}
      </p>
    );
  const href = normalizeMailLink(link);
  function openLink() {
    if (!editor) return;
    if (editor.isActive("link"))
      editor.chain().focus().extendMarkRange("link").run();
    range.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    setLink(editor.getAttributes("link").href ?? "");
    setLinkText(
      editor.state.doc.textBetween(range.current.from, range.current.to),
    );
    setLinkOpen(true);
  }
  function applyLink() {
    if (!editor || !href) return;
    const { from, to } = range.current;
    const selected = editor.state.doc.textBetween(from, to);
    const chain = editor.chain().focus().setTextSelection({ from, to });
    if (from !== to && (!linkText.trim() || linkText === selected))
      chain.setLink({ href }).run();
    else
      chain
        .insertContent({
          type: "text",
          text: linkText.trim() || href,
          marks: [
            {
              type: "link",
              attrs: { href, target: "_blank", rel: "noopener noreferrer" },
            },
          ],
        })
        .run();
    setLinkOpen(false);
  }
  const actions = [
    {
      label: t("ui.bold"),
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: t("ui.italic"),
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: t("ui.underline"),
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: t("ui.bulletList"),
      icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: t("ui.numberedList"),
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: t("ui.alignLeft"),
      icon: AlignLeft,
      active: editor.isActive({ textAlign: "left" }),
      run: () => editor.chain().focus().setTextAlign("left").run(),
    },
    {
      label: t("ui.alignCenter"),
      icon: AlignCenter,
      active: editor.isActive({ textAlign: "center" }),
      run: () => editor.chain().focus().setTextAlign("center").run(),
    },
    {
      label: t("ui.alignRight"),
      icon: AlignRight,
      active: editor.isActive({ textAlign: "right" }),
      run: () => editor.chain().focus().setTextAlign("right").run(),
    },
    {
      label: t("ui.undo"),
      icon: Undo2,
      active: false,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: t("ui.redo"),
      icon: Redo2,
      active: false,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-1 border-b p-1">
        <NativeSelect
          aria-label={t("ui.font")}
          onChange={(e) =>
            editor.chain().focus().setFontFamily(e.target.value).run()
          }
        >
          <NativeSelectOption value="Arial">Arial</NativeSelectOption>
          <NativeSelectOption value="Georgia">Georgia</NativeSelectOption>
          <NativeSelectOption value="monospace">
            {t("ui.monospace")}
          </NativeSelectOption>
        </NativeSelect>
        {actions.map((a) => (
          <Button
            key={a.label}
            type="button"
            variant={a.active ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={a.label}
            aria-pressed={a.active}
            onClick={a.run}
          >
            <a.icon />
          </Button>
        ))}
        <Input
          type="color"
          aria-label={t("ui.textColor")}
          className="h-7 w-8 p-0.5"
          defaultValue="#000000"
          onChange={(e) =>
            editor.chain().focus().setColor(e.target.value).run()
          }
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("ui.insertLink")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLink}
        >
          <Link2 />
        </Button>
        <label
          className="hover:bg-muted inline-flex cursor-pointer rounded-md p-1.5"
          title={t("ui.insertImage")}
        >
          <ImagePlus className="size-4" />
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            aria-label={t("ui.insertImage")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || file.size > 5_000_000) return;
              const reader = new FileReader();
              reader.onload = () =>
                editor
                  .chain()
                  .focus()
                  .setImage({ src: String(reader.result) })
                  .run();
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {linkOpen && (
        <div
          className="space-y-2 border-b p-2"
          role="group"
          aria-label={t("ui.linkSettings")}
        >
          <Input
            aria-label={t("ui.linkText")}
            placeholder={t("ui.displayTextBlankToUseUrl")}
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
          />
          <Input
            aria-label={t("ui.linkUrl")}
            placeholder="https://"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          />
          <Button type="button" size="sm" disabled={!href} onClick={applyLink}>
            {t("ui.insert")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              editor
                .chain()
                .focus()
                .setTextSelection(range.current)
                .extendMarkRange("link")
                .unsetLink()
                .run();
              setLinkOpen(false);
            }}
          >
            {t("ui.removeLink")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLinkOpen(false)}
          >
            {t("ui.cancel")}
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
