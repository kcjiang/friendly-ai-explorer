"""Retain email layout inside the reader sandbox without active content."""

import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit

import tinycss2
from bleach.css_sanitizer import CSSSanitizer

CSS = CSSSanitizer(
    allowed_css_properties=CSSSanitizer().allowed_css_properties
    | frozenset(
        "display box-sizing flex flex-direction flex-wrap flex-basis flex-grow flex-shrink justify-content align-items align-self gap row-gap column-gap grid-template-columns grid-template-rows vertical-align width min-width max-width height min-height max-height margin margin-left margin-right margin-top margin-bottom padding padding-left padding-right padding-top padding-bottom border border-width border-style border-color border-radius border-collapse border-spacing table-layout line-height letter-spacing word-break overflow-wrap white-space text-indent background background-color background-size background-position background-repeat list-style list-style-type".split()
    )
)


def unsafe(tokens):
    for token in tokens:
        if token.type in ("url", "error", "bad-url", "bad-string"):
            return True
        if token.type == "function":
            if token.lower_name not in (
                "rgb",
                "rgba",
                "hsl",
                "hsla",
                "calc",
                "min",
                "max",
                "clamp",
                "linear-gradient",
                "radial-gradient",
            ) or unsafe(token.arguments):
                return True
        if hasattr(token, "content") and unsafe(token.content):
            return True
    return False


def declarations(value):
    parsed = tinycss2.parse_declaration_list(
        value, skip_comments=True, skip_whitespace=True
    )
    safe = [
        part for part in parsed if part.type == "declaration" and not unsafe(part.value)
    ]
    return CSS.sanitize_css(tinycss2.serialize(safe))


def stylesheet(value):
    result = []
    for rule in tinycss2.parse_stylesheet(
        value, skip_comments=True, skip_whitespace=True
    ):
        if rule.type == "qualified-rule" and not unsafe(rule.prelude):
            body = declarations(tinycss2.serialize(rule.content))
            if body:
                result.append(tinycss2.serialize(rule.prelude) + "{" + body + "}")
        elif (
            rule.type == "at-rule"
            and rule.lower_at_keyword == "media"
            and rule.content is not None
            and not unsafe(rule.prelude)
        ):
            result.append(
                "@media "
                + tinycss2.serialize(rule.prelude)
                + "{"
                + stylesheet(tinycss2.serialize(rule.content))
                + "}"
            )
    return "".join(result).replace("<", "\\3c ").replace(">", "\\3e ")


class SafeHTML(HTMLParser):
    allowed = set(
        "html head body p br div span b strong i em u s strike blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col h1 h2 h3 h4 h5 h6 a hr img center font sub sup abbr".split()
    )
    blocked = {"script", "iframe", "object", "embed", "svg", "math", "template"}
    void = {"br", "hr", "img", "col"}

    def __init__(self, images=None, preserve_remote=False):
        super().__init__()
        self.output = []
        self.hidden = 0
        self.images = images or {}
        self.in_style = False
        self.css = []
        self.preserve_remote = preserve_remote
        self.has_remote_images = False

    def handle_starttag(self, tag, attrs):
        if tag in self.blocked:
            self.hidden += 1
        if self.hidden:
            return
        if tag == "style":
            self.in_style = True
            self.css = []
            return
        if tag not in self.allowed:
            return
        attributes = dict(attrs)
        safe = {}
        for key in ("class", "id", "title", "dir", "lang"):
            if attributes.get(key):
                safe[key] = attributes[key][:2000]
        style = declarations(attributes.get("style") or "")
        if style:
            safe["style"] = style
        for key in (
            "width",
            "height",
            "border",
            "cellpadding",
            "cellspacing",
            "colspan",
            "rowspan",
            "size",
        ):
            value = attributes.get(key, "") or ""
            if re.fullmatch(r"\d{1,5}%?", value):
                safe[key] = value
        for key in ("align", "valign", "color", "bgcolor", "face"):
            value = attributes.get(key, "") or ""
            if re.fullmatch(r"[a-zA-Z0-9 #.,\-]{1,200}", value):
                safe[key] = value
        if tag == "img":
            source = attributes.get("src", "") or ""
            if source.startswith("cid:"):
                source = self.images.get(source[4:], "")
            if re.fullmatch(
                r"data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+", source
            ):
                safe["src"] = source
            elif self.preserve_remote:
                try:
                    parts = urlsplit(source)
                except ValueError:
                    return
                if (
                    parts.scheme not in ("https", "http")
                    or not parts.hostname
                    or parts.username
                    or parts.password
                ):
                    return
                safe["data-remote-src"] = source
                self.has_remote_images = True
            else:
                return
            safe["alt"] = attributes.get("alt") or ""
            safe["style"] = style + ";max-width:100%;height:auto"
        if tag == "a":
            href = (attributes.get("href") or "").strip()
            if href.lower().startswith(("https://", "http://", "mailto:", "#")):
                safe.update(
                    href=href,
                    target="_blank" if not href.startswith("#") else "_self",
                    rel="noopener noreferrer",
                )
        extra = "".join(
            " " + key + '="' + escape(value, quote=True) + '"'
            for key, value in safe.items()
        )
        self.output.append("<" + tag + extra + ">")

    def handle_endtag(self, tag):
        if tag in self.blocked:
            self.hidden = max(0, self.hidden - 1)
            return
        if self.hidden:
            return
        if tag == "style":
            if self.in_style:
                self.output.append(
                    "<style>" + stylesheet("".join(self.css)) + "</style>"
                )
            self.in_style = False
            self.css = []
            return
        if tag in self.allowed and tag not in self.void:
            self.output.append("</" + tag + ">")

    def handle_data(self, data):
        if self.hidden:
            return
        if self.in_style:
            self.css.append(data)
        else:
            self.output.append(escape(data))
