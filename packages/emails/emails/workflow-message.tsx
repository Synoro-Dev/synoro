import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import { EmailBadge, EmailHeader, EmailText } from "../components/email-ui";

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
/** Punctuation that ends a sentence rather than the link before it. */
const TRAILING = /[.,;:!?)»]+$/;

/** A line of text with its `https://` links turned into anchors. */
function Linkified({ line }: { line: string }) {
  return line.split(URL_PATTERN).map((part, index) => {
    // `split` with a capturing group puts the links at the odd positions.
    if (index % 2 === 0) return part;
    const tail = TRAILING.exec(part)?.[0] ?? "";
    const href = part.slice(0, part.length - tail.length);
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
      <span key={index}>
        <a href={href}>{href}</a>
        {tail}
      </span>
    );
  });
}

/**
 * The specialist's own message to a client («Про»): subject and text are
 * written by them, with the placeholders already filled in. Blank lines
 * separate paragraphs; links in the text are clickable.
 */
export default function WorkflowMessageEmail({
  practiceName = "Анна Иванова",
  title = "Спасибо за встречу",
  text = "Здравствуйте, Иван!\n\nСпасибо, что были на встрече. Следующее время можно выбрать здесь: https://synoro.ru/p/anna",
}: {
  practiceName: string;
  /** The subject line, repeated as the heading. */
  title: string;
  /** Message body, placeholders filled in. */
  text: string;
}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n"))
    .filter((lines) => lines.some((line) => line.trim()));

  return (
    <EmailLayout
      preview={paragraphs[0]?.[0] ?? title}
      footnote={`Вы получили это письмо, потому что вы клиент: ${practiceName} (через ${APP_CONFIG.shortName}). Если письмо пришло по ошибке, просто не отвечайте на него.`}
    >
      <EmailHeader
        badge={<EmailBadge tone="outline">{practiceName}</EmailBadge>}
        title={title}
      />
      {paragraphs.map((lines) => (
        <EmailText key={lines.join("\n")}>
          {lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines never reorder
            <span key={index}>
              {index > 0 ? <br /> : null}
              <Linkified line={line} />
            </span>
          ))}
        </EmailText>
      ))}
    </EmailLayout>
  );
}
