import StarterKit from "@tiptap/starter-kit";
import { safeRichHref } from "./rich-text";

export function richTextExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      strike: false,
      horizontalRule: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        defaultProtocol: "https",
        isAllowedUri: (url) => !!safeRichHref(url),
      },
    }),
  ];
}
